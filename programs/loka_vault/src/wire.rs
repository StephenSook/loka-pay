use crate::{constants::SECP256R1_ID, error::VaultError, state::VaultConfig};
use anchor_lang::prelude::*;
use solana_instructions_sysvar::{load_current_index_checked, load_instruction_at_checked};

pub const NOTE_LEN: usize = 141;
pub const WITHDRAW_LEN: usize = 161;

pub struct Note {
    pub allowance_id: u64,
    pub payee_hash: [u8; 32],
    pub amount: u64,
    pub serial: u8,
    pub expiry: i64,
}

impl Note {
    pub fn decode(bytes: &[u8; NOTE_LEN]) -> Self {
        Self {
            allowance_id: u64::from_be_bytes(bytes[81..89].try_into().unwrap()),
            payee_hash: bytes[89..121].try_into().unwrap(),
            amount: u64::from_be_bytes(bytes[121..129].try_into().unwrap()),
            serial: bytes[132],
            expiry: i64::from_be_bytes(bytes[133..141].try_into().unwrap()),
        }
    }
}

pub struct Withdrawal {
    pub merchant_hash: [u8; 32],
    pub destination: Pubkey,
    pub amount: u64,
    pub counter: u64,
}

impl Withdrawal {
    pub fn decode(bytes: &[u8; WITHDRAW_LEN]) -> Self {
        Self {
            merchant_hash: bytes[81..113].try_into().unwrap(),
            destination: Pubkey::new_from_array(bytes[113..145].try_into().unwrap()),
            amount: u64::from_be_bytes(bytes[145..153].try_into().unwrap()),
            counter: u64::from_be_bytes(bytes[153..161].try_into().unwrap()),
        }
    }
}

pub fn check_domain(bytes: &[u8], prefix: &[u8; 16], config: &VaultConfig) -> Result<()> {
    require!(
        bytes.len() >= 81 && &bytes[..16] == prefix,
        VaultError::InvalidNote
    );
    require!(
        bytes[16..48] == crate::ID.to_bytes(),
        VaultError::WrongProgram
    );
    require!(bytes[48] == config.cluster, VaultError::WrongCluster);
    require!(
        bytes[49..81] == config.mint.to_bytes(),
        VaultError::WrongMint
    );
    Ok(())
}

/// Bind native verification to this instruction, rather than trusting a client flag.
pub fn verify_precompile(sysvar: &UncheckedAccount, message: &[u8], key: &[u8; 33]) -> Result<()> {
    let info = sysvar.to_account_info();
    let index = load_current_index_checked(&info).map_err(|_| error!(VaultError::BadSysvar))?;
    require!(index > 0, VaultError::BadPrecompile);
    let current = load_instruction_at_checked(usize::from(index), &info)
        .map_err(|_| error!(VaultError::BadPrecompile))?;
    // The sysvar describes top-level instructions. Reject calls through another program.
    require_keys_eq!(current.program_id, crate::ID, VaultError::BadPrecompile);
    let previous = load_instruction_at_checked(usize::from(index - 1), &info)
        .map_err(|_| error!(VaultError::BadPrecompile))?;
    require_keys_eq!(previous.program_id, SECP256R1_ID, VaultError::BadPrecompile);
    let data = &previous.data;
    require!(
        previous.accounts.is_empty() && data.len() == 113 + message.len(),
        VaultError::BadPrecompile
    );
    require!(data[0] == 1 && data[1] == 0, VaultError::BadPrecompile);
    let read = |at| u16::from_le_bytes([data[at], data[at + 1]]);
    require!(
        read(2) == 49 && read(6) == 16 && read(10) == 113,
        VaultError::BadPrecompile
    );
    require!(
        read(4) == u16::MAX && read(8) == u16::MAX && read(14) == u16::MAX,
        VaultError::BadPrecompile
    );
    require!(
        usize::from(read(12)) == message.len(),
        VaultError::BadPrecompile
    );
    require!(data[113..] == *message, VaultError::WrongMessage);
    require!(data[16..49] == *key, VaultError::PayerMismatch);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hex(s: &str) -> Vec<u8> {
        s.as_bytes()
            .chunks_exact(2)
            .map(|c| u8::from_str_radix(std::str::from_utf8(c).unwrap(), 16).unwrap())
            .collect()
    }

    #[test]
    fn golden_notes_and_withdrawals_decode_big_endian() {
        let vectors: serde_json::Value =
            serde_json::from_str(include_str!("../../../protocol/vectors/payment-v1.json"))
                .unwrap();
        for v in vectors["notes"].as_array().unwrap() {
            let bytes: [u8; NOTE_LEN] = hex(v["noteHex"].as_str().unwrap()).try_into().unwrap();
            let n = Note::decode(&bytes);
            assert_eq!(
                n.amount.to_string(),
                v["fields"]["amount"].as_str().unwrap()
            );
            assert_eq!(
                n.allowance_id.to_string(),
                v["fields"]["allowanceId"].as_str().unwrap()
            );
            assert_eq!(n.serial as u64, v["fields"]["serial"].as_u64().unwrap());
            assert_eq!(
                n.expiry.to_string(),
                v["fields"]["expiry"].as_str().unwrap()
            );
            assert_eq!(
                n.payee_hash.to_vec(),
                hex(v["fields"]["payeeKeyHashHex"].as_str().unwrap())
            );
        }
        for v in vectors["withdraws"].as_array().unwrap() {
            let bytes: [u8; WITHDRAW_LEN] =
                hex(v["withdrawHex"].as_str().unwrap()).try_into().unwrap();
            let w = Withdrawal::decode(&bytes);
            assert_eq!(
                w.amount.to_string(),
                v["fields"]["amount"].as_str().unwrap()
            );
            assert_eq!(
                w.counter.to_string(),
                v["fields"]["counter"].as_str().unwrap()
            );
            assert_eq!(
                w.destination.to_bytes().to_vec(),
                hex(v["fields"]["destinationHex"].as_str().unwrap())
            );
        }
    }

    #[test]
    fn units_vectors_and_u64_boundaries_preserve_every_base_unit() {
        let vectors: serde_json::Value =
            serde_json::from_str(include_str!("../../../protocol/vectors/payment-v1.json"))
                .unwrap();
        for v in vectors["units"].as_array().unwrap() {
            let amount = v["baseUnits"].as_str().unwrap().parse::<u64>().unwrap();
            let mut bytes = [0; NOTE_LEN];
            bytes[121..129].copy_from_slice(&amount.to_be_bytes());
            assert_eq!(Note::decode(&bytes).amount, amount);
        }
        for amount in [0, 1, u64::MAX] {
            let mut bytes = [0; NOTE_LEN];
            bytes[121..129].copy_from_slice(&amount.to_be_bytes());
            assert_eq!(Note::decode(&bytes).amount, amount);
        }
    }
}
