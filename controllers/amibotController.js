const fetch = (...args) =>
  import('node-fetch').then(({ default: fetch }) => fetch(...args));

exports.askAmibot = async (req, res) => {
  try {
    const userQuery = req.body.query;

    const response = await fetch('https://amibot-10u4.onrender.com/amibot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: userQuery }),
    });

    if (!response.ok) {
      throw new Error(`AmiBot API error: ${response.status}`);
    }

    const data = await response.json();
    res.status(200).json({ botResponse: data });
  } catch (err) {
    console.error('❌ Error calling AmiBot:', err.message);
    res.status(500).json({ error: 'AmiBot API call failed' });
  }
};
