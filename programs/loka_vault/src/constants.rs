use anchor_lang::prelude::*;

pub const CONFIG_SEED: &[u8] = b"config";
pub const VAULT_SEED: &[u8] = b"vault";
pub const ALLOWANCE_SEED: &[u8] = b"allowance";
pub const MERCHANT_SEED: &[u8] = b"merchant";
pub const MAX_EARMARKS: usize = 16;
pub const MINT_DECIMALS: u8 = 6;
pub const SECP256R1_ID: Pubkey = pubkey!("Secp256r1SigVerify1111111111111111111111111");
