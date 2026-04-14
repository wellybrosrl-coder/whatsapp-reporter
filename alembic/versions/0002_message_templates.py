"""add message templates and frequency columns

Revision ID: 0002
Revises: 0001
Create Date: 2026-04-14
"""
from alembic import op
import sqlalchemy as sa

revision = '0002'
down_revision = '0001'
branch_labels = None
depends_on = None


def upgrade():
    # Template columns — nullable, None means "use built-in default"
    for col in ('template_day', 'template_month', 'template_month_closed'):
        op.add_column('user_settings', sa.Column(col, sa.String(), nullable=True))

    # Frequency columns with defaults matching current behaviour
    op.add_column('user_settings', sa.Column('freq_day', sa.String(), nullable=True, server_default='daily'))
    op.add_column('user_settings', sa.Column('freq_month', sa.String(), nullable=True, server_default='daily'))
    op.add_column('user_settings', sa.Column('freq_month_closed', sa.String(), nullable=True, server_default='monthly'))


def downgrade():
    for col in ('template_day', 'template_month', 'template_month_closed',
                'freq_day', 'freq_month', 'freq_month_closed'):
        op.drop_column('user_settings', col)
