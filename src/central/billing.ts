import { handleMessage } from '../services/mqtt';
import { getMeterByPublicKey, mergeBillingSnapshot, readBillingSnapshot } from '../store/sqlite';
import { DurableProcessor, BillingSnapshot } from './processor';
import { managedBilling } from './billing-context';
import type { UplinkEvent } from './protocol';
import { verifyPayloadSignature, distributeManaged } from '../lib/utils';
import { meterIdFromPublicKeyContractCall, meterLatestNonceContractCall } from '../utils/contracts';
import { createLogger } from '../utils/logger';

export function billingSnapshot(event:UplinkEvent):BillingSnapshot {
  return readBillingSnapshot(event.deviceInfo.devEui);
}
export function createBillingProcessor(filename:string):DurableProcessor {
  return new DurableProcessor(filename,async(event,sink)=>{
    const context={id:event.deduplicationId!,distribution:[]};
    await managedBilling.run(context,()=>handleMessage(Buffer.from(JSON.stringify(event)),sink));
    void distributeManaged(context.distribution).catch(()=>{});
  },billingSnapshot,importBillingSnapshot);
}

const logger=createLogger('[central]');
/** Accept another decider's billing state (a gateway's fallback decisions) after
 * checking it against the meter's signatures, its token and the chain. */
export async function importBillingSnapshot(snapshot:BillingSnapshot, distribute=true):Promise<void> {
      const meter=snapshot.meter;if(!meter)return;
      const known=getMeterByPublicKey(meter.publicKey);
      const token=known?.tokenId ?? await meterIdFromPublicKeyContractCall(meter.publicKey);
      if(token!==meter.tokenId)throw new Error('Reconciliation meter token does not match the contract.');
      const chainNonce=await meterLatestNonceContractCall(token);
      if(!Number.isSafeInteger(chainNonce)||chainNonce<0)throw new Error('Cannot verify reconciliation against the chain.');
      let supportedNonce=Math.max(known?.latestNonce??-1,chainNonce);
      const records=[...snapshot.transactions].sort((a,b)=>a.nonce-b.nonce);
      // First contact: central has never seen this meter, for example a gateway that ran
      // standalone before joining central. Its history is not here, so start from the oldest
      // meter-signed record (still checked below). Once central knows the meter, gaps are refused.
      if(!known&&records.length&&records[0].nonce>supportedNonce+1){
        logger.warn(`Meter ${token} is new to central: starting its history at nonce ${records[0].nonce} (chain has ${chainNonce}); earlier readings stay with the gateway that billed them.`);
        supportedNonce=records[0].nonce-1;
      }
      for(const record of records){
        const bytes=Buffer.from(record.raw,'hex');
        if(record.identifier!==token || record.nonce!==bytes.readUInt32BE(0) ||
          bytes.length<74 || !verifyPayloadSignature(bytes,Buffer.from(meter.publicKey.replace(/^0x/,''),'hex')))throw new Error('Invalid signed reconciliation record.');
        if(record.nonce>supportedNonce+1)throw new Error(`Reconciliation has a gap before nonce ${record.nonce} (central can confirm up to ${supportedNonce}).`);
        supportedNonce=Math.max(supportedNonce,record.nonce);
      }
      if(meter.latestNonce>supportedNonce)throw new Error(`Reconciliation nonce ${meter.latestNonce} is not supported by signed records or the chain (up to ${supportedNonce}).`);
      mergeBillingSnapshot(snapshot);
      // Only central publishes what another decider handed over. (Older gateways may list readings they
      // already sent to the prover; that is ignored: the prover is resent until the chain confirms.)
      if(process.env.CONSOLE_ROLE!=='central'||!distribute)return;
      void distributeManaged(snapshot.transactions).catch(()=>{});
}
