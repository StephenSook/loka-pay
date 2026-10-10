use crate::{constants::*, error::VaultError, state::*};
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

#[derive(Accounts)]
#[instruction(args: OpenAllowanceArgs)]
pub struct OpenAllowance<'info> {
    #[account(mut)]
    pub funder: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, VaultConfig>,
    #[account(init, payer = funder, space = 8 + Allowance::INIT_SPACE,
        seeds = [ALLOWANCE_SEED, args.allowance_id.to_be_bytes().as_ref()], bump)]
    pub allowance: Account<'info, Allowance>,
    #[account(seeds = [VAULT_SEED, config.mint.as_ref()], bump = vault.bump)]
    pub vault: Account<'info, VaultAuthority>,
    #[account(address = config.mint @ VaultError::WrongMint)]
    pub mint: Account<'info, Mint>,
    #[account(mut, token::mint = mint, token::authority = funder)]
    pub source: Account<'info, TokenAccount>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = vault)]
    pub vault_tokens: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handle_open(ctx: Context<OpenAllowance>, args: OpenAllowanceArgs) -> Result<()> {
    require!(
        args.cap > 0 && args.offline_limit <= args.cap,
        VaultError::InvalidLimits
    );
    require!(
        args.expiry > Clock::get()?.unix_timestamp,
        VaultError::Expired
    );
    require!(
        matches!(args.payer_key[0], 2 | 3),
        VaultError::InvalidPayerKey
    );
    require!(
        args.earmarks.len() <= MAX_EARMARKS && args.earmarks.windows(2).all(|w| w[0] < w[1]),
        VaultError::InvalidEarmarks
    );
    let deposited = args
        .cap
        .checked_add(args.bond)
        .ok_or(VaultError::Overflow)?;
    token::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.source.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.vault_tokens.to_account_info(),
                authority: ctx.accounts.funder.to_account_info(),
            },
        ),
        deposited,
        ctx.accounts.mint.decimals,
    )?;
    ctx.accounts.allowance.set_inner(Allowance {
        id: args.allowance_id,
        funder: ctx.accounts.funder.key(),
        payer_key: args.payer_key,
        cap: args.cap,
        redeemed: 0,
        offline_limit: args.offline_limit,
        expiry: args.expiry,
        bond: args.bond,
        earmarks: args.earmarks,
        used_serials: [0; 32],
        bump: ctx.bumps.allowance,
    });
    Ok(())
}
