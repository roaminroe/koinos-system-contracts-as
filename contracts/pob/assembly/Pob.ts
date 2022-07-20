import { BigInt } from 'as-bigint';
import { UInt256 as u256 } from './UInt256';
import { chain, System, Protobuf, Base64, authority,
    Base58, value, system_calls, Token, Crypto, pob, Arrays } from "koinos-sdk-as";

namespace Constants {
  /**
   *  Because tokens are added to the supply each block, we need a slightly lower rate to
   *  account for the compounding interest. We can use the equation:
   *
   *  ( 1 + x / blocks_per_year ) ^ blocks_per_year = 1 + desired_inflation_rate
   *
   *  Solving for x and simplifying yields:
   *
   *  x = blocks_per_year * ( ( 1 + desired_inflation_rate ) ^ ( 1 / blocks_per_year ) - 1 )
   */
  export const DEFAULT_ANNUAL_INFLATION_RATE: u32 = 198; // 2%
  export const DEFAULT_TARGET_BURN_PERCENT: u32 = 50100; // 50.1%
  export const DEFAULT_TARGET_BLOCK_INTERVAL_MS: u32 = 3000; // 3s
  export const DEFAULT_QUANTUM_LENGTH_MS: u32 = 10;
  export const METADATA_KEY: Uint8Array = new Uint8Array(0);
  export const CONSENSUS_PARAMS_KEY: Uint8Array = new Uint8Array(1);
  export const INITIAL_DIFFICULTY_BITS:u8 = 48;
  export const FIXED_POINT_PRECISION :u32 = 1000;
  export const MILLISECONDS_PER_YEAR = 31536000000;

  let contractId: Uint8Array | null = null;
  let koinContractId: Uint8Array | null = null;
  let vhpContractId: Uint8Array | null = null;
  let u256Max: u256 | null = null;

  export function ContractId() : Uint8Array {
    if (contractId === null) {
      contractId = System.getContractId()
    }

    return contractId!;
  }

  export function KoinContractId() : Uint8Array {
    if (koinContractId === null) {
      if (BUILD_FOR_TESTING) {
        // Address: BRmrUgtSQVUggoeE9weG4f7nidyydnYfQ
        koinContractId = Arrays.fromHexString("007260aeafadc70431ea9c3fbef135b9a415c10f5195e8d557");
      } else {
        // Address: 19JntSm8pSNETT9aHTwAUHC5RMoaSmgZPJ
        koinContractId = Arrays.fromHexString("005b1e61d37259b9c2d99bf417f592e0b77725165d2488be45");
      }
    }

    return koinContractId!;
  }

  export function VhpContractId(): Uint8Array {
    if (vhpContractId === null ) {
      if (BUILD_FOR_TESTING) {
        // Address: 1CZvRyRuNxghMUUNGqsKsT5x55r6wugd1C
        vhpContractId = Arrays.fromHexString("007ee34bc608c04cd537347cf7302815774fcf750c6a8775f3");
      } else {
        // Address: 1JZqj7dDrK5LzvdJgufYBJNUFo88xBoWC8
        vhpContractId = Arrays.fromHexString("00c0b01fa4bbcd9f061e0df292670ca0dbfaa6526adb88ae09");
      }
    }

    return vhpContractId!;
  }

  export function U256Max(): u256 {
    if (u256Max === null) {
      u256Max = new u256().negate();
    }

    return u256Max!;
  }
}

namespace State {
  export namespace Space {
    let registration : chain.object_space | null = null;
    let metadata : chain.object_space | null = null;

    export function Registration() : chain.object_space {
      if (registration === null) {
        registration = new chain.object_space(true, Constants.ContractId(), 0);
      }

      return registration!;
    }

    export function Metadata() : chain.object_space {
      if (metadata === null) {
        metadata = new chain.object_space(true, Constants.ContractId(), 1);
      }

      return metadata!;
    }
  }
}

/*
function BigIntFromBytes(bytes: Uint8Array): BigInt {
  let num = BigInt.ZERO

  for (let i = 0; i < bytes.length; i++){
    num = num.leftShift(8).bitwiseOr(bytes[i])
  }

//  for (let i = 0; i < 8; i++ ) {
//    let word = bytes[ 31 - ( 4 * i ) ]
//          | ( bytes[ 31 - ( 4 * i ) - 1 ] << 8 )
//          | ( bytes[ 31 - ( 4 * i ) - 2 ] << 16 )
//          | ( bytes[ 31 - ( 4 * i ) - 3 ] << 24 );
//
//    num = num.leftShift(32).bitwiseOr(word);
//  }

  return num;
}

function BytesFromBigInt(num: BigInt): Uint8Array {
  let bytes = new Uint8Array(32)

  for (let i = 0; i < 8; i++ ) {
    let word = num.bitwiseAnd(0xFFFFFFFF).toUInt32()
    bytes[ 31 - (4 * i) ]     =  0x000000FF & word;
    bytes[ 31 - (4 * i) - 1 ] = (0x0000FF00 & word) >> 8;
    bytes[ 31 - (4 * i) - 2 ] = (0x00FF0000 & word) >> 16;
    bytes[ 31 - (4 * i) - 3 ] = (0xFF000000 & word) >> 24;

    num = num.rightShift(32);
  }

  return bytes;
}
*/

export class Pob {
  register_public_key(args: pob.register_public_key_arguments): pob.register_public_key_result {
    System.require(args.producer != null, 'producer cannot be null');

    System.requireAuthority(authority.authorization_type.contract_call, args.producer!);

    // Create and store the record
    if(args.public_key == null ) {
      System.removeObject(State.Space.Registration(), args.producer!)
    } else {
      const record = new pob.public_key_record(args.public_key!);
      System.putObject(State.Space.Registration(), args.producer!, record, pob.public_key_record.encode);
    }

    // Emit an event
    const event = new pob.register_public_key_event(args.producer!, args.public_key);
    System.event('pob.register_public_key', Protobuf.encode(event, pob.register_public_key_event.encode), [args.producer!]);

    return new pob.register_public_key_result();
  }

  burn(args: pob.burn_arguments): pob.burn_result {
    const koin = new Token(Constants.KoinContractId());
    const vhp = new Token(Constants.VhpContractId());
    const amount = args.token_amount;

    // Burn the token
    System.require(koin.burn(args.burn_address!, amount), "could not burn KOIN");

    // Mint the new VHP
    System.require(vhp.mint(args.vhp_address!, amount), "could not mint VHP");

    return new pob.burn_result();
  }

  process_block_signature(args: system_calls.process_block_signature_arguments): system_calls.process_block_signature_result {
    const sig_data_bytes = args.signature!;
    const signature = Protobuf.decode<pob.signature_data>(sig_data_bytes, pob.signature_data.decode);
    const signer = args.header!.signer!;
    const timestamp = args.header!.timestamp;
    const head_block_time = System.getHeadInfo().head_block_time;

    const koin = new Token(Constants.KoinContractId());
    const vhp = new Token(Constants.VhpContractId());

    const metadata = this.fetch_metadata();
    const params = this.fetch_consensus_parameters();

    // Check block quanta
    System.require(args.header!.timestamp % params.quantum_length == 0, "time stamp does not match time quanta");

    // Get signer's public key
    const registration = System.getObject<Uint8Array, pob.public_key_record>(State.Space.Registration(), signer, pob.public_key_record.decode);
    System.require(registration != null, "signer address has no public key record");

    // Create vrf payload and serialize it
    const payload = new pob.vrf_payload(metadata.seed, timestamp);
    const payload_bytes = Protobuf.encode(payload, pob.vrf_payload.encode);

    System.require(System.verifyVRFProof(registration!.public_key!, signature.vrf_proof!, signature.vrf_hash!, payload_bytes), "proof failed vrf validation");

    // Ensure vrf hash divided by producer's vhp is below difficulty
    const difficulty = u256.deserialize(metadata.difficulty!);
    const target = Constants.U256Max().div(difficulty, true);
    let mh = new Crypto.Multihash();
    mh.deserialize(signature.vrf_hash!)
    const hash = u256.deserialize(mh.digest);
    const vhp_balance = u256.fromNumber(vhp.balanceOf(signer));

    hash.div(vhp_balance, true );

    System.require(hash.lt(target), "provided hash is not sufficient");

    const virtual_supply = koin.totalSupply() + vhp.totalSupply();
    const yearly_inflation = virtual_supply * params.target_annual_inflation_rate / Constants.FIXED_POINT_PRECISION;

    const blocks_per_year = Constants.MILLISECONDS_PER_YEAR / params.target_block_interval;

    const block_reward = yearly_inflation / blocks_per_year;
    const vhp_reduction = (virtual_supply * params.target_burn_percent) / (blocks_per_year * Constants.FIXED_POINT_PRECISION);

    // On successful block deduct vhp and mint new koin
    System.require(vhp.burn(signer, vhp_reduction), "could not burn vhp");
    System.require(koin.mint(signer, block_reward + vhp_reduction), "could not mint token");

    this.update_difficulty(difficulty, metadata, params, head_block_time, signature.vrf_hash!);

    return new system_calls.process_block_signature_result(true);
  }

  get_metadata(args: pob.get_metadata_arguments): pob.get_metadata_result {
    const metadata = this.fetch_metadata();
    return new pob.get_metadata_result(metadata);
  }

  update_difficulty(difficulty:u256, metadata:pob.metadata, params:pob.consensus_parameters, current_block_time:u64, vrf_hash:Uint8Array): void {
    // This is a generalization of Ethereum's Homestead difficulty adjustment algorithm
    let block_time_denom = (10000 * params.target_block_interval) / 14000;

    // Calulate new difficulty
    let new_difficulty = difficulty.div(u256.fromNumber(2048));
    let multiplier:i64 = 1 - i64(current_block_time - metadata.last_block_time) / block_time_denom;
    multiplier = multiplier > -99 ? multiplier : -99;
    if (multiplier >= 0)
      new_difficulty.mul(u256.fromNumber(u64(multiplier)), true)
    else
      new_difficulty.mul(u256.fromNumber(u64(-multiplier)), true)

    new_difficulty.add(difficulty, true);

    let new_data = new pob.metadata();
    new_data.difficulty = new_difficulty.serialize();
    new_data.seed = System.hash(Crypto.multicodec.sha2_256, vrf_hash);
    new_data.last_block_time = current_block_time;

    System.putObject(State.Space.Metadata(), Constants.METADATA_KEY, new_data, pob.metadata.encode);
  }

  fetch_metadata(): pob.metadata {
    const data = System.getObject<Uint8Array, pob.metadata>(State.Space.Metadata(), Constants.METADATA_KEY, pob.metadata.decode);

    if (data) {
      return data;
    }

    // Initialize new metadata
    let new_data = new pob.metadata();

    new_data.difficulty = u256.fromNumber(1).shl(Constants.INITIAL_DIFFICULTY_BITS - 1).serialize();
    new_data.seed = System.getChainId();
    new_data.last_block_time = System.getHeadInfo().head_block_time;

    return new_data;
  }

  get_consensus_parameters(args: pob.get_consensus_parameters_arguments): pob.get_consensus_parameters_result {
    return new pob.get_consensus_parameters_result(this.fetch_consensus_parameters());
  }

  fetch_consensus_parameters(): pob.consensus_parameters {
    const data = System.getObject<Uint8Array, pob.consensus_parameters>(State.Space.Metadata(), Constants.CONSENSUS_PARAMS_KEY, pob.consensus_parameters.decode);

    if (data) {
      return data;
    }

    // Initialize new consensus_parameters
    let new_data = new pob.consensus_parameters();

    new_data.target_annual_inflation_rate = Constants.DEFAULT_ANNUAL_INFLATION_RATE;
    new_data.target_burn_percent = Constants.DEFAULT_TARGET_BURN_PERCENT;
    new_data.target_block_interval = Constants.DEFAULT_TARGET_BLOCK_INTERVAL_MS;
    new_data.quantum_length = Constants.DEFAULT_QUANTUM_LENGTH_MS;

    return new_data;
  }
}
