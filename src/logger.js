function log(fields) {
  console.log(JSON.stringify({ time: new Date().toISOString(), ...fields }));
}

module.exports = { log };