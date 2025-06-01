// controllers/portfolioController.js

const getPortfolio = (req, res) => {
  const portfolioData = {
    name: "Amritanshu Mishra",
    description:
      "Passionate and detail-oriented Software Engineer with a strong foundation in full-stack development and 6+ years of hands-on experience building scalable web applications and services. Proficient in modern JavaScript frameworks, API architecture, and cloud deployment. Adept at translating complex business requirements into clean, efficient code. Enjoys working in agile environments, collaborating across teams, and constantly learning new technologies. Proven ability to deliver robust solutions that improve performance, usability, and customer satisfaction.",
    title: "Full Stack Developer",
    email: "amritanshu99@gmail.com",
    phone: "+91 9149194704",
    summary:
      "Experienced software engineer with 6+ years in MERN stack development. As a language-agnostic technologist, I quickly master new technologies and excel in solving complex problems.\nA natural problem solver, I thrive on tackling complex challenges and devising innovative solutions. My passion for technology and continuous learning drives me to stay at the forefront of industry advancements. I am deeply committed to collaboration and teamwork, leveraging my skills to make a meaningful impact on every project I undertake.\n\nLet’s connect and explore how we can drive success and innovation together.",
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
        role: "Associate Consultant",
        duration: "2022 - Present",
        description: "Working on React, Node.js, Apollo GraphQL and AI.",
        achievements: [
          "Won many prizes in various domains",
          "Received numerous appreciations from clients and managers",
          "Built highly scalable solutions",
          "Led the team with impactful and out-of-the-box solutions that were praised across the board",
        ],
      },
      {
        company: "ConQsys",
        role: "Senior Software Engineer",
        duration: "2019 - 2022",
        description: "Working on React, Node.js, Apollo GraphQL and more.",
        achievements: [
          "Received multiple client appreciations",
          "Doubled the revenue of the client-side project and organization within 1 year",
          "Won multiple prizes for out-of-the-box thinking",
          "Delivered high-impact and high-value contributions within projects",
        ],
      },
    ],
    education: [
      {
        institution: "Rajkumar Goel Institute Of Technology GZB",
        degree: "B.Tech in Electronics and Communication Engg.",
        year: "2015 - 2019",
        achievements: [
          "Organized many college-level events",
          "Participated as a volunteer at IISF Lucknow 2018",
          "Attended and participated in multiple seminars on the use of technology",
          "Developed the smallest RF antenna as a final year project across all colleges in the region",
          "Actively involved in NGOs like 'Light the Literacy'",
        ],
      },
      {
        institution: "Ramanlal Shorawala Public School Mathura",
        degree: "10th and 12th",
        year: "2001 - 2014",
        achievements: [
          "Head Boy of school",
          "Interviewed by a national-level newspaper",
          "One of the highest percentages across batch in 10th and 12th",
          "Won many awards in sports",
          "Won many awards in debate competitions",
          "Performed and won awards in stand-up comedy events",
        ],
      },
    ],
    photoUrl: "/images/your-photo.png",
    socialLinks: {
      linkedin: "https://www.linkedin.com/in/amritanshu-mishra-568598306/",
      github: "https://github.com/amritanshu99",
      instagram: "https://www.instagram.com/ami.mishra99/",
      facebook: "https://www.facebook.com/Ami.Mishra99",
    },
  };

  res.json(portfolioData);
};

module.exports = { getPortfolio };
