use crate::{
    constants::*,
    error::VaultError,
    state::*,
    wire::{self, Withdrawal, WITHDRAW_LEN},
};
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};
use solana_instructions_sysvar::ID as INSTRUCTIONS_ID;

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, VaultConfig>,
    #[account(mut, seeds = [MERCHANT_SEED, merchant.key_hash.as_ref()], bump = merchant.bump)]
    pub merchant: Account<'info, Merchant>,
    #[account(seeds = [VAULT_SEED, config.mint.as_ref()], bump = vault.bump)]
    pub vault: Account<'info, VaultAuthority>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = vault)]
    pub vault_tokens: Account<'info, TokenAccount>,
    #[account(address = config.mint @ VaultError::WrongMint)]
    pub mint: Account<'info, Mint>,
    /// CHECK: Must equal the signed destination; only its canonical ATA receives tokens.
    pub destination: UncheckedAccount<'info>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = destination)]
    pub destination_tokens: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    /// CHECK: Address-constrained canonical sysvar, read only with checked loaders.
    #[account(address = INSTRUCTIONS_ID @ VaultError::BadSysvar)]
    pub instructions: UncheckedAccount<'info>,
}

pub fn handle_withdraw(ctx: Context<Withdraw>, bytes: [u8; WITHDRAW_LEN]) -> Result<()> {
    wire::verify_precompile(
        &ctx.accounts.instructions,
        &bytes,
        &ctx.accounts.merchant.public_key,
    )?;
    wire::check_domain(&bytes, b"LOKA-PAY-WDRW-V1", &ctx.accounts.config)?;
    let withdrawal = Withdrawal::decode(&bytes);
    let merchant = &mut ctx.accounts.merchant;
    require!(
        withdrawal.merchant_hash == merchant.key_hash,
        VaultError::InvalidMerchant
    );
    require_keys_eq!(
        withdrawal.destination,
        ctx.accounts.destination.key(),
        VaultError::BadDestination
    );
    require!(withdrawal.amount > 0, VaultError::InvalidNote);
    require!(
        withdrawal.counter == merchant.withdraw_counter,
        VaultError::WithdrawalReplay
    );
    let balance = merchant
        .balance
        .checked_sub(withdrawal.amount)
        .ok_or(VaultError::InsufficientBalance)?;
    let counter = merchant
        .withdraw_counter
        .checked_add(1)
        .ok_or(VaultError::Overflow)?;
    let bump = [ctx.accounts.vault.bump];
    let seeds: &[&[u8]] = &[VAULT_SEED, ctx.accounts.config.mint.as_ref(), &bump];
    token::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.vault_tokens.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.destination_tokens.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            &[seeds],
        ),
        withdrawal.amount,
        ctx.accounts.mint.decimals,
    )?;
    merchant.balance = balance;
    merchant.withdraw_counter = counter;
    emit!(Withdrawn {
        merchant_key_hash: withdrawal.merchant_hash,
        destination: withdrawal.destination,
        amount: withdrawal.amount,
        counter: withdrawal.counter
    });
    Ok(())
}
