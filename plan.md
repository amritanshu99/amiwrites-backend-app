# AmiBot Data-Grounded Chat Implementation

## What Was Implemented

- AmiBot now uses the same Gemini model configuration as `/api/gemini`.
- Admin can upload AmiBot knowledge from PDF and `.xlsx` Excel files.
- Uploaded files are parsed, chunked, and stored in MongoDB.
- AmiBot answers only from uploaded knowledge chunks.
- If AmiBot cannot find an answer:
  - Guest users get a "not in uploaded knowledge" reply.
  - Logged-in users get the same reply, their question is saved for admin, and admin email is triggered.
- Logged-in users get persistent AmiBot chat history.
- Admin can view pending questions, answer them, close them, and optionally save answers back into AmiBot knowledge.
- AmiBot admin UI is protected by the same admin username approach used by blog creation/deletion: `amritanshu99` by default.

## Backend Files

- `controllers/amibotController.js`
- `routes/amibotRoutes.js`
- `models/AmiBotKnowledgeSource.js`
- `models/AmiBotKnowledgeChunk.js`
- `models/AmiBotChatMessage.js`
- `models/AmiBotQuestion.js`
- `middleware/optionalAuthMiddleware.js`
- `middleware/adminMiddleware.js`
- `utils/geminiService.js`
- `utils/amibotKnowledge.js`
- `test/amibotKnowledge.test.js`

## Frontend Files

- `src/components/AmiBot/AmiBot.jsx`
- `src/components/AmiBot/AmiBotAdmin.jsx`
- `src/pages/AmiBotAdmin.jsx`
- `src/App.jsx`
- `src/components/Layout/Header.jsx`

## New Backend Endpoints

- `POST /api/amibot`
  - Public chat endpoint.
  - Uses optional auth.
  - Saves history only if user is logged in.
  - Creates pending admin question only if user is logged in and knowledge cannot answer.

- `GET /api/amibot/history`
  - Logged-in user only.
  - Returns that user's AmiBot history.

- `DELETE /api/amibot/history`
  - Logged-in user only.
  - Clears that user's AmiBot history.

- `GET /api/amibot/admin/questions`
  - Admin only.
  - Optional query: `status=pending|answered|closed`.

- `PATCH /api/amibot/admin/questions/:id/answer`
  - Admin only.
  - Body: `{ "answer": "...", "addToKnowledge": true }`.

- `PATCH /api/amibot/admin/questions/:id/close`
  - Admin only.

- `GET /api/amibot/admin/knowledge`
  - Admin only.

- `POST /api/amibot/admin/knowledge/upload`
  - Admin only.
  - Multipart field name: `file`.
  - Optional multipart field: `sourceName`.
  - Supports `.pdf` and `.xlsx`.

- `POST /api/amibot/admin/knowledge/embeddings/backfill`
  - Admin only.
  - Optional JSON/query `limit` controls the chunk batch size.

- `DELETE /api/amibot/admin/knowledge/:id`
  - Admin only.

## Environment Variables

Required existing vars:

- `MONGO_URI`
- `JWT_SECRET`
- `GEMINI_API_KEY`
- `RESEND_API_KEY`
- `MAIL_FROM`

New AmiBot vars added to `.env.example`:

- `AMIBOT_ADMIN_USERNAME=amritanshu99`
- `AMIBOT_ADMIN_EMAIL=amritanshu0909@gmail.com`
- `AMIBOT_UPLOAD_MAX_BYTES=10485760`
- `AMIBOT_MAX_CHUNKS_PER_UPLOAD=300`
- `AMIBOT_EMBEDDINGS_ENABLED=true`
- `GEMINI_EMBEDDING_MODEL=gemini-embedding-2`
- `GEMINI_EMBEDDING_DIMENSIONS=768`

If `AMIBOT_ADMIN_EMAIL` is not set, AmiBot falls back to `CONTACT_TO_EMAIL`.

## How To Use With Your PDF And Excel

1. Start backend and frontend.
2. Log in with the admin account: `amritanshu99`.
3. Open `/amibot-admin`.
4. In Knowledge, upload:
   - PDF files.
   - Excel files in `.xlsx` format.
5. For Excel, keep the first row as clear column headers. Example:
   - `Question | Answer | Category`
   - `Project | Description | Skills`
6. Open `/amibot`.
7. Ask questions based on the uploaded files.
8. If the answer exists in uploaded data, AmiBot answers from that data.
9. If the answer is missing:
   - Guest users only see a missing-data reply.
   - Logged-in users create a pending admin question and trigger email notification.
10. Admin answers pending questions from `/amibot-admin`.
11. If "Save answer into AmiBot knowledge" is checked, future users can get that answer directly from AmiBot.

## Important Notes

- `.xlsx` is supported. Old `.xls` files should be saved/exported as `.xlsx` before upload.
- PDF quality matters. Text-based PDFs work best; scanned image PDFs may need OCR before upload.
- Current retrieval uses hybrid scoring: MongoDB text/token matches plus Gemini embeddings when chunk vectors are available. It falls back to text/token search when embeddings are disabled or unavailable.
- The model prompt is strict: answer only from provided knowledge context, otherwise mark the answer as missing.
- Admin auth still follows the existing username-based pattern. A future improvement would be adding a `role` field on users.

## Verification Run

- Backend syntax checks passed.
- Backend tests passed: `npm test`.
- Backend audit passed: `npm audit --omit=dev`.
- PDF parser verified against `public/images/Resume.pdf`.
- `.xlsx` parser verified with an in-memory OpenXML workbook.
- Frontend production build passed.
- Frontend tests passed in CI mode.

