import { JsonRpcProvider, Contract, isAddress } from 'ethers';
import { retry } from '../lib/utils';
import { createLogger } from '../utils/logger';

const logger = createLogger('[Context]');

const rpcUrl = process.env.MAINNET_RPC;

logger.info('using RPC', rpcUrl);

export const provider = new JsonRpcProvider(rpcUrl);

export let rollup!: Contract;

const rollupRef = process.env.ROLLUP_CONTRACT_ADDRESS || 'rollup.m3ter.eth';

const rollupAbi = [
  'function nonce(uint64) external view returns (uint24)',
  'function m3terId(bytes32 key) external view returns (uint64)',
  'function publicKey(uint256) view returns (bytes32)',
];

export const ccipRevenueReader = new Contract(
  process.env.CCIP_REVENUE_READER_ADDRESS || '0xD648cdF47e9534B2FCfb18C1E94CA9AAff07BA0E',
  [
    'function read(uint256 tokenId, address target, address verifier) public view returns (uint256)',
    'function readCallback(bytes[] memory data, bytes memory) external pure returns (uint256)',
    'function verifierCount() external view returns (uint256)',
    'function verifiers(uint256) external view returns (string, address)',
  ],
  provider,
);

export const priceContext = new Contract(
  process.env.PRICE_CONTEXT_ADDRESS || '0xc6D5Ff8E80F4Ee511Db4bCf6a0BcEbF9f41aAA32',
  ['function owed(uint256 tokenId) public view returns (uint256)'],
  provider,
);

async function resolveContractAddress(contractName: string, ref: string): Promise<string> {
  if (isAddress(ref)) {
    logger.info(`[ethers] ${contractName}: using address ${ref}`);
    return ref;
  }

  logger.info(`[ethers] ${contractName}: resolving ENS name ${ref}...`);

  const resolved = await retry(() => provider.resolveName(ref), 3, 1500);
  if (!resolved) {
    throw new Error(`[ethers] ${contractName}: failed to resolve ENS ${ref}`);
  }

  logger.info(`[ethers] ${contractName}: resolved ENS ${ref} -> ${resolved}`);
  return resolved;
}

export const contractsReady = async () => {
  if (rollup) return;
  const rollupAddress = await resolveContractAddress('rollup', rollupRef);

  rollup = new Contract(rollupAddress, rollupAbi, provider);
};
