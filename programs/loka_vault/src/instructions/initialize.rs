use crate::{constants::*, error::VaultError, state::*};
use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{Mint, Token, TokenAccount},
};
use solana_sha256_hasher::hash;

#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(address = crate::ID)]
    pub program: Program<'info, crate::program::LokaVault>,
    #[account(
        constraint = program.programdata_address()? == Some(program_data.key()) @ VaultError::InvalidAuthority,
        constraint = program_data.upgrade_authority_address == Some(authority.key()) @ VaultError::InvalidAuthority
    )]
    pub program_data: Account<'info, ProgramData>,
    #[account(init, payer = authority, space = 8 + VaultConfig::INIT_SPACE, seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, VaultConfig>,
    #[account(init, payer = authority, space = 8 + VaultAuthority::INIT_SPACE, seeds = [VAULT_SEED, mint.key().as_ref()], bump)]
    pub vault: Account<'info, VaultAuthority>,
    #[account(constraint = mint.decimals == MINT_DECIMALS @ VaultError::InvalidMintDecimals)]
    pub mint: Account<'info, Mint>,
    // A third party may create this canonical ATA before initialization.
    #[account(init_if_needed, payer = authority, associated_token::mint = mint, associated_token::authority = vault)]
    pub vault_tokens: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_initialize(ctx: Context<InitializeVault>, cluster: u8) -> Result<()> {
    require!(cluster <= 1, VaultError::WrongCluster);
    ctx.accounts.config.set_inner(VaultConfig {
        mint: ctx.accounts.mint.key(),
        cluster,
        bump: ctx.bumps.config,
    });
    ctx.accounts.vault.bump = ctx.bumps.vault;
    Ok(())
}

#[derive(Accounts)]
#[instruction(public_key: [u8; 33])]
pub struct RegisterMerchant<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, VaultConfig>,
    #[account(init, payer = payer, space = 8 + Merchant::INIT_SPACE,
        seeds = [MERCHANT_SEED, hash(&public_key).as_ref()], bump)]
    pub merchant: Account<'info, Merchant>,
    pub system_program: Program<'info, System>,
}

pub fn handle_register(ctx: Context<RegisterMerchant>, public_key: [u8; 33]) -> Result<()> {
    require!(matches!(public_key[0], 2 | 3), VaultError::InvalidPayerKey);
    ctx.accounts.merchant.set_inner(Merchant {
        public_key,
        key_hash: hash(&public_key).to_bytes(),
        balance: 0,
        withdraw_counter: 0,
        bump: ctx.bumps.merchant,
    });
    Ok(())
}
