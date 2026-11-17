import { handleMessage } from '../services/mqtt';
import { getMeterByPublicKey, mergeBillingSnapshot, readBillingSnapshot } from '../store/sqlite';
import { DurableProcessor, BillingSnapshot } from './processor';
import { managedBilling } from './billing-context';
import type { UplinkEvent } from './protocol';
import { verifyPayloadSignature, distributeManaged } from '../lib/utils';
import { meterIdFromPublicKeyContractCall, meterLatestNonceContractCall } from '../utils/contracts';

export function billingSnapshot(event:UplinkEvent):BillingSnapshot {
  return readBillingSnapshot(event.deviceInfo.devEui);
}
export function createBillingProcessor(filename:string):DurableProcessor {
  return new DurableProcessor(filename,async(event,sink)=>{
    const context={id:event.deduplicationId!,distribution:[]};
    await managedBilling.run(context,()=>handleMessage(Buffer.from(JSON.stringify(event)),sink));
    void distributeManaged(context.distribution).catch(()=>{});
  },billingSnapshot,async snapshot=>{
      const meter=snapshot.meter;if(!meter)return;
      const known=getMeterByPublicKey(meter.publicKey);
      const token=known?.tokenId ?? await meterIdFromPublicKeyContractCall(meter.publicKey);
      if(token!==meter.tokenId)throw new Error('Reconciliation meter token does not match the contract.');
      const chainNonce=await meterLatestNonceContractCall(token);
      if(!Number.isSafeInteger(chainNonce)||chainNonce<0)throw new Error('Cannot verify reconciliation against the chain.');
      let supportedNonce=Math.max(known?.latestNonce??-1,chainNonce);
      for(const record of [...snapshot.transactions].sort((a,b)=>a.nonce-b.nonce)){
        const bytes=Buffer.from(record.raw,'hex');
        if(record.identifier!==token || record.nonce!==bytes.readUInt32BE(0) ||
          bytes.length<74 || !verifyPayloadSignature(bytes,Buffer.from(meter.publicKey.replace(/^0x/,''),'hex')))throw new Error('Invalid signed reconciliation record.');
        if(record.nonce>supportedNonce+1)throw new Error('Reconciliation has a gap before this nonce.');
        supportedNonce=Math.max(supportedNonce,record.nonce);
      }
      if(meter.latestNonce>supportedNonce)throw new Error('Reconciliation nonce is not supported by signed records or the chain.');
      mergeBillingSnapshot(snapshot);
      void distributeManaged(snapshot.transactions).catch(()=>{});
    });
}
