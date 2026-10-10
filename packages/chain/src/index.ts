/**
 * Public surface of @archprop/chain.
 *
 * Only read-only, non-broadcasting helpers are exported. This package must not
 * grow a write path or accept a private key; that is a deliberate boundary.
 */

export {
  ARBITRUM_SEPOLIA_CHAIN_ID,
  ANVIL_CHAIN_ID,
  SUPPORTED_CHAIN_IDS,
  isSupportedChainId,
  isAnvilChainId,
  CHAIN_NAME,
  NATIVE_CURRENCY,
  arbitrumSepolia,
} from "./chain";

export {
  CONTRACT_KEYS,
  CONTRACT_ADDRESS_ENV,
  RPC_URL_ENV,
  ChainConfigError,
  loadChainConfig,
  inspectChainConfig,
  parseRpcUrl,
  parseContractAddress,
} from "./config";
export type {
  ChainConfig,
  ChainConfigReport,
  ContractAddress,
  ContractAddresses,
  ContractKey,
} from "./config";

export {
  ChainMismatchError,
  assertSupportedChainId,
  createArchpropPublicClient,
  createArchpropChainReader,
  createArchpropChainReaderFromEnv,
} from "./clients";
export type {
  ArchpropChainReader,
  PublicClientFactory,
} from "./clients";

export {
  ASSET_STATUS_ENUM,
  ATTESTATION_TYPE_ENUM,
  OFFERING_STATUS_ENUM,
  UnknownEnumValueError,
  decodeAssetStatus,
  decodeAttestationType,
  decodeOfferingStatus,
  encodeAssetStatus,
  encodeAttestationType,
  encodeOfferingStatus,
  LIFECYCLE_ORDER,
  TERMINAL_LIFECYCLE_STATES,
  isTerminalLifecycleStatus,
  GOLDEN_PATH_LIFECYCLE,
} from "./enums";
export type { OfferingStatus, EnumName } from "./enums";

export {
  InvalidAmountError,
  isDecimalIntegerString,
  parseAmount,
  parseOptionalAmount,
  formatAmount,
  formatAmountWithSeparators,
  isValidAmount,
  assertValidAmount,
  isBytes32,
  isNonZeroBytes32,
  assertNonZeroHash,
  isUint256,
  assertUint256,
  assertUint64,
} from "./numbers";

export {
  archpropRegistryAbi,
  identityRegistryAbi,
  mockIdrAbi,
  propertyTokenAbi,
  offeringEscrowAbi,
  revenueDistributorAbi,
} from "./abi";
