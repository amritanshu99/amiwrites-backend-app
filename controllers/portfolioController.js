const cache = require("../utils/cache");

const getPortfolio = (req, res) => {
  const cachedData = cache.get("portfolio");
  if (cachedData) {
    console.log("🔁 Serving portfolio from cache");
    return res.json(cachedData);
  }

  const portfolioData = {
    name: "Amritanshu Mishra",
    description:
      "I build reliable web products and AI-assisted experiences with React, Node.js, GraphQL, and modern machine-learning tools. Over 7+ years, I have turned complex product requirements into scalable, maintainable software.",
    title: "Full-stack & AI Engineer",
    email: "amritanshu99@gmail.com",
    phone: "+91 9149194704",
    summary: "",
    skills: [
      { skill: "JavaScript", expertise: "Expert" },
      { skill: "React", expertise: "Expert" },
      { skill: "Node.js", expertise: "Expert" },
      { skill: "Express", expertise: "Expert" },
      { skill: "MongoDB", expertise: "Expert" },
      { skill: "GraphQL", expertise: "Advanced" },
      { skill: "AI", expertise: "Advanced" },
      { skill: "ML", expertise: "Advanced" },
    ],
    experience: [
      {
        company: "GlobalLogic",
        role: "Associate Consultant",
        duration: "2022 - Present",
        description:
          "Building scalable product experiences with React, Node.js, Apollo GraphQL, and AI.",
        achievements: [
          "Designed and delivered scalable solutions for complex product requirements.",
          "Led the team with practical, high-impact approaches praised by clients and leadership.",
          "Received multiple awards and appreciations across engineering initiatives.",
        ],
      },
      {
        company: "ConQsys",
        role: "Senior Software Engineer",
        duration: "2019 - 2022",
        description:
          "Delivered full-stack products using React, Node.js, Apollo GraphQL, and supporting services.",
        achievements: [
          "Helped double revenue for a client-side project within one year.",
          "Received multiple client appreciations for high-value delivery.",
          "Won recognition for original problem-solving and product thinking.",
        ],
      },
    ],
    education: [
      {
        institution: "Rajkumar Goel Institute of Technology, Ghaziabad",
        degree: "B.Tech in Electronics and Communication Engineering",
        duration: "2015 - 2019",
        achievements: [
          "Developed a compact RF antenna as the final-year engineering project.",
          "Volunteered at IISF Lucknow 2018 and organized college-level events.",
        ],
      },
      {
        institution: "Ramanlal Shorawala Public School, Mathura",
        degree: "Secondary and Senior Secondary Education",
        duration: "2001 - 2014",
        achievements: [
          "Served as Head Boy and received recognition in academics, sports, and debate.",
        ],
      },
    ],
    photoUrl: "/images/your-photo.png",
    photoUrlDark: "/images/your-photo-dark.png",
    socialLinks: {
      linkedin: "https://www.linkedin.com/in/amritanshu-mishra-568598306/",
      github: "https://github.com/amritanshu99",
      instagram: "https://www.instagram.com/ami.mishra99/",
      facebook: "https://www.facebook.com/Ami.Mishra99",
    },
  };

  // ✅ Cache the data for next time
  cache.set("portfolio", portfolioData);
  console.log("🗃️ Serving portfolio from DB and caching it");

  res.json(portfolioData);
};

module.exports = { getPortfolio };
