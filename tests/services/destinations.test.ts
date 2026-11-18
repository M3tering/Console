import { normalizeHost, classifyAddress, resolveTarget, destinationRoute } from '../../src/central/destinations';

test.each(['127.0.0.1','127.1','2130706433','0177.0.0.1','0x7f000001','[::1]','[::ffff:127.0.0.1]','[::ffff:7f00:1]', '10.0.0.1','172.16.0.1','192.168.1.1','169.254.1.1','fc00::1','fe80::1234'])('classifies local address %s', address => {
  expect(classifyAddress(address)).toBe('local');
});
test.each(['169.254.169.254','[fd00:ec2::254]','[::ffff:169.254.169.254]','0.0.0.0','::','224.0.0.1','ff02::1','64:ff9b::a00:1','2002:7f00:1::1'])('refuses metadata, unspecified, multicast and translation address %s', address => {
  expect(classifyAddress(address)).toBe('blocked');
});
test.each(['fe80::1%eth0','[fe80::1%25eth0]','user@127.0.0.1','localhost/path','localhost?x','127.0.0.1\\@example.com'])('rejects ambiguous host %s', address=>expect(()=>normalizeHost(address)).toThrow());
test('pins the classified address and rejects mixed DNS answers',async()=>{
  const resolve=jest.fn().mockResolvedValueOnce([{address:'8.8.8.8',family:4}]).mockResolvedValueOnce([{address:'127.0.0.1',family:4}]);
  const first=await resolveTarget('site.example',resolve);
  expect(first.address).toBe('8.8.8.8');expect(first.classification).toBe('public');
  // The transport must dial first.address, never perform a second DNS lookup.
  expect(resolve).toHaveBeenCalledTimes(1);
  const second=await resolveTarget('site.example',resolve);expect(second.classification).toBe('local');
  await expect(resolveTarget('mixed.example',async()=>[{address:'8.8.8.8',family:4},{address:'127.0.0.1',family:4}])).rejects.toThrow('Mixed');
});
test('central private requests use the selected gateway, or the central host when none is selected', async()=>{
  const target=await resolveTarget('127.0.0.1');
  const typed={pageClass:'public' as const,userNavigation:true,topLevel:true};
  expect(destinationRoute('standalone',target,typed)).toBe('local');
  expect(destinationRoute('gateway',target,typed)).toBe('local');
  expect(destinationRoute('central',target,typed,'gateway-1')).toBe('agent');
  expect(destinationRoute('central',target,typed)).toBe('local');
  expect(()=>destinationRoute('central',target,{pageClass:'public',userNavigation:false,topLevel:false})).toThrow('Public');
  for(const context of [{...typed,userNavigation:false},{...typed,topLevel:false}]) expect(()=>destinationRoute('central',target,context,'gateway-1')).toThrow('Public');
  expect(destinationRoute('central',target,{pageClass:'local',userNavigation:false,topLevel:false},'gateway-1')).toBe('agent');
});
test('redirects must be reclassified and lose the user-navigation authorization',async()=>{
  const target=await resolveTarget('8.8.8.8');
  expect(destinationRoute('central',target,{pageClass:'public',userNavigation:false,topLevel:false})).toBe('internet');
  const redirect=await resolveTarget('127.0.0.1');
  expect(()=>destinationRoute('central',redirect,{pageClass:'public',userNavigation:false,topLevel:true},'gateway-1')).toThrow();
});
