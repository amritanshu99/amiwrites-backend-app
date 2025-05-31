// controllers/portfolioController.js

const getPortfolio = (req, res) => {
  const portfolioData = {
    name: "Amritanshu Mishra",
    description:
      "Passionate and detail-oriented Software Engineer with a strong foundation in full-stack development and 7+ years of hands-on experience building scalable web applications and services. Proficient in modern JavaScript frameworks, API architecture, and cloud deployment. Adept at translating complex business requirements into clean, efficient code. Enjoys working in agile environments, collaborating across teams, and constantly learning new technologies. Proven ability to deliver robust solutions that improve performance, usability, and customer satisfaction.",
    title: "Full Stack Developer",
    email: "your.email@example.com",
    phone: "+91 1234567890",
    summary: "Passionate developer with 7 years experience in MERN stack...",
    skills: [
      { skill: "JavaScript", expertise: "expert" },
      { skill: "React", expertise: "expert" },
      { skill: "Node.js", expertise: "expert" },
      { skill: "Express", expertise: "expert" },
      { skill: "MongoDB", expertise: "expert" },
      { skill: "GraphQL", expertise: "advanced" },
    ],

    experience: [
      {
        company: "GlobalLogic",
        role: "Senior Developer",
        duration: "2019 - Present",
        description: "Working on React, Node.js, Apollo GraphQL and more.",
        achievements: [
          "kjsgjasfhsghsgklhglkhskdlgha",
          "fgfgfdgfagagf",
          "aksfhslhgasghaslkghklghslghsalg",
          "safdsfsdfgdsg",
          "ahglsfglsaghslhgasghaslghaslghaslgh",
          "asgdsgsgsdgdsgdsa",
          "hslhgslghsalghslghlaskghsklghsklghslkglsfgdafg",
          "asdgdsgfsdgdasg",
        ],
      },
      {
        company: "GlobalLogic",
        role: "Senior Developer",
        duration: "2019 - Present",
        description: "Working on React, Node.js, Apollo GraphQL and more.",
        achievements: [
          "kjsgjasfhsghsgklhglkhskdlgha",
          "fgfgfdgfagagf",
          "aksfhslhgasghaslkghklghslghsalg",
          "safdsfsdfgdsg",
          "ahglsfglsaghslhgasghaslghaslghaslgh",
          "asgdsgsgsdgdsgdsa",
          "hslhgslghsalghslghlaskghsklghsklghslkglsfgdafg",
          "asdgdsgfsdgdasg",
        ],
      },
    ],
    education: [
      {
        institution: "XYZ University",
        degree: "B.Tech in Computer Science",
        year: "2015 - 2019",
        achievements: [
          "kjsgjasfhsghsgklhglkhskdlgha",
          "fgfgfdgfagagf",
          "aksfhslhgasghaslkghklghslghsalg",
          "safdsfsdfgdsg",
          "ahglsfglsaghslhgasghaslghaslghaslgh",
          "asgdsgsgsdgdsgdsa",
          "hslhgslghsalghslghlaskghsklghsklghslkglsfgdafg",
          "asdgdsgfsdgdasg",
        ],
      },
      {
        institution: "XYZ University",
        degree: "B.Tech in Computer Science",
        year: "2015 - 2019",
        achievements: [
          "kjsgjasfhsghsgklhglkhskdlgha",
          "fgfgfdgfagagf",
          "aksfhslhgasghaslkghklghslghsalg",
          "safdsfsdfgdsg",
          "ahglsfglsaghslhgasghaslghaslghaslgh",
          "asgdsgsgsdgdsgdsa",
          "hslhgslghsalghslghlaskghsklghsklghslkglsfgdafg",
          "asdgdsgfsdgdasg",
        ],
      },
    ],
    photoUrl: "/images/your-photo.png",
    socialLinks: {
      linkedin: "https://linkedin.com/in/yourprofile",
      github: "https://github.com/yourusername",
      instagram: "https://www.instagram.com/ami.mishra99/",
      facebook: "https://www.facebook.com/Ami.Mishra99",
    },
  };

  res.json(portfolioData);
};

module.exports = { getPortfolio };
