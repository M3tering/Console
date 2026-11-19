jest.mock('../../src/utils/contracts',()=>({meterLatestNonceContractCall:jest.fn()}));
jest.mock('../../src/store/sqlite',()=>({getAllMeterRecords:jest.fn(),pruneGatewayHistory:jest.fn()}));
jest.mock('node-cron',()=>({validate:jest.fn(()=>true),schedule:jest.fn(()=>({destroy:jest.fn()}))}));
import cron from 'node-cron';
import { getAllMeterRecords, pruneGatewayHistory } from '../../src/store/sqlite';
import { meterLatestNonceContractCall } from '../../src/utils/contracts';
import { pruneConfirmedGatewayHistory, startGatewayPruning } from '../../src/central/gateway-pruning';

beforeEach(()=>{jest.clearAllMocks();});

test('a failed confirmation read keeps that meter while other meters can prune',async()=>{
  jest.mocked(getAllMeterRecords).mockReturnValue([{tokenId:7},{tokenId:8}] as any);
  jest.mocked(meterLatestNonceContractCall).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(10);
  jest.mocked(pruneGatewayHistory).mockReturnValue(3);
  expect(await pruneConfirmedGatewayHistory('central|gateway')).toBe(3);
  expect(pruneGatewayHistory).toHaveBeenCalledTimes(1);
  expect(pruneGatewayHistory).toHaveBeenCalledWith('central|gateway',8,10);
});

test('the default and configurable cron run in UTC without overlapping',()=>{
  const previous=process.env.GATEWAY_PRUNE_CRONSCHEDULE;
  try{
    delete process.env.GATEWAY_PRUNE_CRONSCHEDULE;
    startGatewayPruning(()=> 'target');
    expect(cron.schedule).toHaveBeenLastCalledWith('*/5 * * * *',expect.any(Function),expect.objectContaining({noOverlap:true,timezone:'UTC'}));
    process.env.GATEWAY_PRUNE_CRONSCHEDULE='0 * * * *';startGatewayPruning(()=> 'target');
    expect(cron.schedule).toHaveBeenLastCalledWith('0 * * * *',expect.any(Function),expect.any(Object));
    jest.mocked(cron.validate).mockReturnValueOnce(false);
    expect(()=>startGatewayPruning(()=> 'target')).toThrow('GATEWAY_PRUNE_CRONSCHEDULE');
  }finally{if(previous===undefined)delete process.env.GATEWAY_PRUNE_CRONSCHEDULE;else process.env.GATEWAY_PRUNE_CRONSCHEDULE=previous;}
});
