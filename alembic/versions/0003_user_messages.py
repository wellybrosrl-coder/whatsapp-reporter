"""create user_messages table

Revision ID: 0003
Revises: 0002
Create Date: 2026-04-14
"""
from alembic import op
import sqlalchemy as sa

revision = '0003'
down_revision = '0002'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'user_messages',
        sa.Column('id', sa.Integer(), nullable=False, autoincrement=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('title', sa.String(), nullable=True, server_default=''),
        sa.Column('template', sa.String(), nullable=True, server_default=''),
        sa.Column('data_type', sa.String(), nullable=True, server_default='day'),
        sa.Column('freq', sa.String(), nullable=True, server_default='daily'),
        sa.Column('sort_order', sa.Integer(), nullable=True, server_default='0'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_user_messages_user_id', 'user_messages', ['user_id'])


def downgrade():
    op.drop_index('ix_user_messages_user_id', table_name='user_messages')
    op.drop_table('user_messages')
