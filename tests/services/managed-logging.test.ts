import { createLogger } from '../../src/utils/logger';

test('managed logs retain operation IDs but redact secrets, provider errors and signed payloads',()=>{
  const before={...process.env};
  process.env.CONSOLE_ROLE='central';process.env.API_TOKEN='test-fixture-api-secret';
  process.env.CENTRAL_ADMIN_PASSWORD='test-fixture-password';
  const log=jest.spyOn(console,'log').mockImplementation(()=>{}),error=jest.spyOn(console,'error').mockImplementation(()=>{});
  try{
    const logger=createLogger('[test]');
    logger.info('Operation status',{gateway:'gateway-test',id:'event-1',state:'uncertain',raw:'ab'.repeat(106),publicKey:'cd'.repeat(32)});
    logger.error('API test-fixture-api-secret',{password:'test-fixture-password',credential:'sensitive-credential'},new Error('sensitive-provider-response'));
    logger.info(`Signed payload ${'ab'.repeat(74)}`);
    const output=JSON.stringify([...log.mock.calls,...error.mock.calls]);
    expect(output).toContain('event-1');expect(output).toContain('uncertain');
    for(const secret of ['test-fixture-api-secret','test-fixture-password','sensitive-credential','sensitive-provider-response','ab'.repeat(74),'cd'.repeat(32)])expect(output).not.toContain(secret);
  }finally{log.mockRestore();error.mockRestore();process.env=before;}
});
