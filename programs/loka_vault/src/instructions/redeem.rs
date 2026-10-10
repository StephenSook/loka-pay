use crate::{
    constants::*,
    error::VaultError,
    state::*,
    wire::{self, Note, NOTE_LEN},
};
use anchor_lang::prelude::*;
use solana_instructions_sysvar::ID as INSTRUCTIONS_ID;
use solana_sha256_hasher::hash;

#[derive(Accounts)]
pub struct RedeemNote<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, VaultConfig>,
    #[account(mut, seeds = [ALLOWANCE_SEED, allowance.id.to_be_bytes().as_ref()], bump = allowance.bump)]
    pub allowance: Account<'info, Allowance>,
    #[account(mut, seeds = [MERCHANT_SEED, merchant.key_hash.as_ref()], bump = merchant.bump)]
    pub merchant: Account<'info, Merchant>,
    /// CHECK: Address-constrained canonical sysvar, read only with checked loaders.
    #[account(address = INSTRUCTIONS_ID @ VaultError::BadSysvar)]
    pub instructions: UncheckedAccount<'info>,
}

pub fn handle_redeem(ctx: Context<RedeemNote>, bytes: [u8; NOTE_LEN]) -> Result<()> {
    // PAYMENT-V1 sections 7 and 8.1-3 bind verification to these bytes and this payer.
    wire::verify_precompile(
        &ctx.accounts.instructions,
        &bytes,
        &ctx.accounts.allowance.payer_key,
    )?;
    wire::check_domain(&bytes, b"LOKA-PAY-NOTE-V1", &ctx.accounts.config)?;
    let note = Note::decode(&bytes);
    require!(
        &bytes[129..132] == b"USD" && note.amount > 0,
        VaultError::InvalidNote
    );
    let allowance = &mut ctx.accounts.allowance;
    let merchant = &mut ctx.accounts.merchant;
    // Section 8.5: seeds/ownership above plus the signed identities below.
    require!(
        allowance.id == note.allowance_id,
        VaultError::InvalidAllowance
    );
    require!(
        merchant.key_hash == note.payee_hash,
        VaultError::InvalidMerchant
    );
    let byte = usize::from(note.serial / 8);
    let bit = 1u8 << (note.serial % 8);
    require!(
        allowance.used_serials[byte] & bit == 0,
        VaultError::SerialUsed
    );
    let redeemed = allowance
        .redeemed
        .checked_add(note.amount)
        .ok_or(VaultError::Overflow)?;
    require!(redeemed <= allowance.cap, VaultError::CapExceeded);
    let now = Clock::get()?.unix_timestamp;
    require!(
        now <= note.expiry && now <= allowance.expiry && note.expiry <= allowance.expiry,
        VaultError::Expired
    );
    require!(
        allowance.earmarks.is_empty() || allowance.earmarks.contains(&note.payee_hash),
        VaultError::EarmarkDenied
    );
    let balance = merchant
        .balance
        .checked_add(note.amount)
        .ok_or(VaultError::Overflow)?;
    // Sections 8.6-10: transaction failure rolls back every ledger change together.
    allowance.used_serials[byte] |= bit;
    allowance.redeemed = redeemed;
    merchant.balance = balance;
    emit!(NoteRedeemed {
        note_id: hash(&bytes).to_bytes(),
        allowance_id: note.allowance_id,
        serial: note.serial,
        merchant_key_hash: note.payee_hash,
        amount: note.amount
    });
    Ok(())
}
