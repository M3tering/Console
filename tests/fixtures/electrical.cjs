// Independent byte fixture from the 97-byte layout supplied with the feature.
// Not a captured firmware sample; signed fields deliberately include negatives.
module.exports = function frame(options = {}) {
  const b = Buffer.alloc(97); b[0] = options.version ?? 1; b[1] = options.flags ?? 0x9d;
  b.writeUInt32BE(options.uptime ?? 86461, 2);
  [23012,23123,23234,101,202,303,45,67].forEach((v,i) => b.writeUInt16BE(v,6+i*2));
  [-1001,2002,3003,options.power ?? 4004,-1111,2222,-3333,-2222].forEach((v,i) => b.writeInt32BE(v,22+i*4));
  [-998,999,1000,-950].forEach((v,i) => b.writeInt16BE(v,54+i*2));
  b.writeUInt16BE(5001,62); b.writeInt8(-12,64);
  [12345,23456,34567,options.forward ?? 70368,111,222,333,options.reverse ?? 666].forEach((v,i) => b.writeUInt32BE(v,65+i*4));
  return b;
};
