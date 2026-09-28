const { test, beforeEach, afterEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const Task = require("../models/Task");
const controller = require("../controllers/taskController");
const cache = require("../utils/cache");

const userId = "507f1f77bcf86cd799439011";
const goalId = "507f1f77bcf86cd799439012";
const dailyId = "507f1f77bcf86cd799439013";
let records;
const document = (task) => ({ ...task, toObject: () => ({ ...task }) });
function matches(task, query) {
  return Object.entries(query).every(([key, value]) => {
    if (key === "$or") return value.some((clause) => matches(task, clause));
    if (value && typeof value === "object" && "$exists" in value) return (task[key] !== undefined) === value.$exists;
    return String(task[key]) === String(value);
  });
}
function response() {
  return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}
function request(body = {}, id = dailyId) { return { user: { id: userId }, body, params: { id } }; }
function daily(overrides = {}) {
  return { _id: dailyId, userId, title: "Write outline", boardType: "daily", plannedDate: "2026-09-29", linkedGoalId: goalId, status: "todo", ...overrides };
}

beforeEach(() => {
  records = [{ _id: goalId, userId, title: "Publish a book", status: "in-progress" }];
  cache.flushAll();
  mock.method(Task, "findOne", (query) => ({ lean: async () => records.find((task) => matches(task, query)) || null }));
  mock.method(Task, "find", (query) => ({ sort: () => ({ lean: async () => records.filter((task) => matches(task, query)) }) }));
  mock.method(Task, "create", async (payload) => { const task = { ...payload, _id: dailyId }; records.push(task); return document(task); });
  mock.method(Task, "findOneAndUpdate", async (query, update) => {
    const task = records.find((item) => matches(item, query));
    if (!task) return null;
    Object.assign(task, update.$set);
    return document(task);
  });
  mock.method(Task, "findOneAndDelete", async (query) => {
    const task = records.find((item) => matches(item, query));
    records = records.filter((item) => item !== task);
    return task || null;
  });
  mock.method(Task, "updateMany", async (query, update) => {
    records.filter((task) => matches(task, query)).forEach((task) => Object.assign(task, update.$set));
  });
});
afterEach(() => { mock.restoreAll(); cache.flushAll(); });

test("legacy tasks stay on the goals board and new linked daily work survives a fresh read", async () => {
  const initial = response();
  await controller.getAllTasks(request(), initial);
  assert.equal(initial.body[0].boardType, "goals");
  const created = response();
  await controller.createTask(request(daily()), created);
  assert.equal(created.statusCode, 201);
  assert.equal(created.body.linkedGoalId, goalId);
  const loaded = response();
  await controller.getAllTasks(request(), loaded);
  assert.equal(loaded.body.length, 2);
  assert.equal(loaded.body.find((task) => task._id === dailyId).plannedDate, "2026-09-29");
});

test("daily tasks can be independent, rescheduled, linked, and unlinked", async () => {
  const created = response();
  await controller.createTask(request(daily({ linkedGoalId: null })), created);
  assert.equal(created.statusCode, 201);
  const linked = response();
  await controller.updateTask(request({ plannedDate: "2026-09-30", linkedGoalId: goalId }), linked);
  assert.equal(linked.statusCode, 200);
  assert.equal(linked.body.plannedDate, "2026-09-30");
  assert.equal(linked.body.linkedGoalId, goalId);
  const unlinked = response();
  await controller.updateTask(request({ linkedGoalId: null, status: "done" }), unlinked);
  assert.equal(unlinked.body.linkedGoalId, null);
  assert.equal(records[0].status, "in-progress");
});

test("rejects missing, invalid, and overflow planned dates on create and update", async () => {
  records.push(daily());
  for (const plannedDate of [null, "", "2026-02-31", "2026-13-01", "tomorrow", "2026-09-29T00:00:00Z"]) {
    for (const handler of [controller.createTask, controller.updateTask]) {
      const res = response();
      await handler(request(daily({ plannedDate })), res);
      assert.equal(res.statusCode, 400, String(plannedDate));
    }
  }
  assert.equal(Task.create.mock.calls.length, 0);
  assert.equal(Task.findOneAndUpdate.mock.calls.length, 0);
});

test("rejects another user's goal, daily-to-daily links, missing goals and self links", async () => {
  records.push(daily());
  const foreignId = "507f1f77bcf86cd799439014";
  const anotherDailyId = "507f1f77bcf86cd799439015";
  records.push({ _id: foreignId, userId: "someone-else", boardType: "goals" });
  records.push(daily({ _id: anotherDailyId }));
  for (const linkedGoalId of [foreignId, anotherDailyId, dailyId, "507f1f77bcf86cd799439016", "invalid"]) {
    const res = response();
    await controller.updateTask(request({ linkedGoalId }), res);
    assert.equal(res.statusCode, 400);
  }
  const foreignCreate = response();
  await controller.createTask(request(daily({ linkedGoalId: foreignId })), foreignCreate);
  assert.equal(foreignCreate.statusCode, 400);
  assert.equal(Task.findOneAndUpdate.mock.calls.length, 0);
});

test("goals cannot carry daily planning fields or switch boards", async () => {
  for (const body of [{ boardType: "daily", plannedDate: "2026-09-29" }, { linkedGoalId: dailyId }, { plannedDate: "2026-09-29" }]) {
    const res = response();
    await controller.updateTask(request(body, goalId), res);
    assert.equal(res.statusCode, 400);
  }
});

test("deleting a goal unlinks daily work only for its owner and invalidates cached tasks", async () => {
  records.push(daily(), daily({ _id: "foreign-daily", userId: "someone-else" }));
  cache.set(`tasks_${userId}`, ["stale"]);
  const res = response();
  await controller.deleteTask(request({}, goalId), res);
  assert.equal(res.statusCode, 200);
  assert.equal(records.find((task) => task._id === dailyId).linkedGoalId, null);
  assert.equal(records.find((task) => task._id === "foreign-daily").linkedGoalId, goalId);
  assert.equal(cache.get(`tasks_${userId}`), undefined);
  assert.equal(records.length, 2);
});

test("cannot edit or delete another user's tasks", async () => {
  records.push(daily({ userId: "someone-else" }));
  for (const handler of [controller.updateTask, controller.deleteTask]) {
    const res = response();
    await handler(request({ title: "Changed" }), res);
    assert.equal(res.statusCode, 404);
  }
  assert.equal(Task.findOneAndUpdate.mock.calls.length, 0);
});
