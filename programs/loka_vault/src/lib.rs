pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;
pub mod wire;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("HSgcxix3LGjdCQ7FGexBosdvzmHz7ZfHdkpyXYYteBGG");

#[program]
pub mod loka_vault {
    use super::*;

    pub fn initialize_vault(ctx: Context<InitializeVault>, cluster: u8) -> Result<()> {
        instructions::initialize::handle_initialize(ctx, cluster)
    }

    pub fn register_merchant(ctx: Context<RegisterMerchant>, public_key: [u8; 33]) -> Result<()> {
        instructions::initialize::handle_register(ctx, public_key)
    }
    pub fn open_allowance(ctx: Context<OpenAllowance>, args: OpenAllowanceArgs) -> Result<()> {
        instructions::open::handle_open(ctx, args)
    }
    pub fn redeem_note(ctx: Context<RedeemNote>, note: [u8; 141]) -> Result<()> {
        instructions::redeem::handle_redeem(ctx, note)
    }
    pub fn withdraw(ctx: Context<Withdraw>, message: [u8; 161]) -> Result<()> {
        instructions::withdraw::handle_withdraw(ctx, message)
    }
}
