"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-04-12
"""
from alembic import op
import sqlalchemy as sa

revision = '0001'
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'users',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('email', sa.String(), nullable=False, unique=True),
        sa.Column('password_hash', sa.String(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_users_email', 'users', ['email'], unique=True)

    op.create_table(
        'user_settings',
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id'), primary_key=True),
        sa.Column('ipratico_email', sa.String(), nullable=True),
        sa.Column('ipratico_password_enc', sa.String(), nullable=True),
        sa.Column('ipratico_channel', sa.String(), nullable=True, server_default='lct_20572'),
        sa.Column('greenapi_id_instance', sa.String(), nullable=True),
        sa.Column('greenapi_api_token_enc', sa.String(), nullable=True),
        sa.Column('greenapi_api_url', sa.String(), nullable=True, server_default='https://7107.api.greenapi.com'),
        sa.Column('greenapi_chat_id', sa.String(), nullable=True),
        sa.Column('greenapi_chat_name', sa.String(), nullable=True),
        sa.Column('send_time', sa.String(), nullable=True, server_default='01:00'),
        sa.Column('timezone', sa.String(), nullable=True, server_default='Europe/Rome'),
        sa.Column('is_active', sa.Boolean(), nullable=True, server_default=sa.false()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
    )


def downgrade():
    op.drop_table('user_settings')
    op.drop_index('ix_users_email', table_name='users')
    op.drop_table('users')
