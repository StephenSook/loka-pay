use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct VaultConfig {
    pub mint: Pubkey,
    pub cluster: u8,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct VaultAuthority {
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Allowance {
    pub id: u64,
    pub funder: Pubkey,
    pub payer_key: [u8; 33],
    pub cap: u64,
    pub redeemed: u64,
    pub offline_limit: u64,
    pub expiry: i64,
    pub bond: u64,
    #[max_len(16)]
    pub earmarks: Vec<[u8; 32]>,
    pub used_serials: [u8; 32],
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Merchant {
    pub public_key: [u8; 33],
    pub key_hash: [u8; 32],
    pub balance: u64,
    pub withdraw_counter: u64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct OpenAllowanceArgs {
    pub allowance_id: u64,
    pub payer_key: [u8; 33],
    pub cap: u64,
    pub offline_limit: u64,
    pub expiry: i64,
    pub bond: u64,
    pub earmarks: Vec<[u8; 32]>,
}

#[event]
pub struct NoteRedeemed {
    pub note_id: [u8; 32],
    pub allowance_id: u64,
    pub serial: u8,
    pub merchant_key_hash: [u8; 32],
    pub amount: u64,
}

#[event]
pub struct Withdrawn {
    pub merchant_key_hash: [u8; 32],
    pub destination: Pubkey,
    pub amount: u64,
    pub counter: u64,
}
