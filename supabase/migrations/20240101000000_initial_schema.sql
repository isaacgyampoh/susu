-- ============================================================
-- SUSU MANAGEMENT SYSTEM — INITIAL SCHEMA
-- Supabase PostgreSQL Migration
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- ENUMS
-- ============================================================
CREATE TYPE member_status      AS ENUM ('pending','active','suspended','removed');
CREATE TYPE group_status       AS ENUM ('open','full','active','completed');
CREATE TYPE membership_status  AS ENUM ('active','defaulted','completed');
CREATE TYPE contribution_freq  AS ENUM ('daily','weekly','monthly');
CREATE TYPE contribution_status AS ENUM ('pending','paid','overdue');
CREATE TYPE payout_status      AS ENUM ('upcoming','processing','paid');
CREATE TYPE kyc_status         AS ENUM ('pending','approved','rejected');
CREATE TYPE tx_type            AS ENUM ('registration_fee','contribution','payout');
CREATE TYPE tx_status          AS ENUM ('pending','success','failed');
CREATE TYPE notif_type         AS ENUM ('sms','whatsapp','in_app');
CREATE TYPE notif_status       AS ENUM ('pending','sent','failed');

-- ============================================================
-- ADMIN USERS
-- ============================================================
CREATE TABLE admin_users (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name     TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin','super_admin')),
  is_active     BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- MEMBERS
-- ============================================================
CREATE SEQUENCE member_id_seq START 1;

CREATE TABLE members (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  member_id            TEXT UNIQUE,                          -- SSU-0001
  full_name            TEXT NOT NULL,
  phone                TEXT UNIQUE NOT NULL,
  email                TEXT,
  whatsapp_number      TEXT,
  ghana_card_number    TEXT UNIQUE NOT NULL,
  ghana_card_front_url TEXT,
  ghana_card_back_url  TEXT,
  passcode_hash        TEXT,                                 -- hashed 6-digit PIN
  status               member_status DEFAULT 'pending',
  date_of_birth        DATE,
  occupation           TEXT,
  residential_address  TEXT,
  bank_name            TEXT,
  bank_account_number  TEXT,
  bank_account_name    TEXT,
  mobile_money_number  TEXT,
  mobile_money_provider TEXT,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-generate SSU-XXXX member ID on insert
CREATE OR REPLACE FUNCTION fn_set_member_id()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.member_id IS NULL THEN
    NEW.member_id := 'SSU-' || LPAD(nextval('member_id_seq')::TEXT, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_set_member_id
  BEFORE INSERT ON members
  FOR EACH ROW EXECUTE FUNCTION fn_set_member_id();

-- ============================================================
-- SUSU GROUPS
-- ============================================================
CREATE TABLE susu_groups (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                  TEXT NOT NULL,
  description           TEXT,
  contribution_amount   DECIMAL(10,2) NOT NULL,
  contribution_frequency contribution_freq NOT NULL DEFAULT 'daily',
  cycle_days            INTEGER NOT NULL DEFAULT 15,   -- days per payout cycle
  max_members           INTEGER NOT NULL,
  current_members       INTEGER DEFAULT 0,
  registration_fee      DECIMAL(10,2) NOT NULL DEFAULT 0,
  status                group_status DEFAULT 'open',
  start_date            DATE,
  end_date              DATE,
  rules                 TEXT,
  image_url             TEXT,
  created_by            UUID REFERENCES admin_users(id),
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- GROUP MEMBERSHIPS
-- ============================================================
CREATE TABLE group_memberships (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  member_id       UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  group_id        UUID NOT NULL REFERENCES susu_groups(id) ON DELETE CASCADE,
  payout_position INTEGER NOT NULL,          -- slot 1 = first to receive
  payout_date     DATE,
  payout_amount   DECIMAL(10,2),
  payout_received BOOLEAN DEFAULT false,
  status          membership_status DEFAULT 'active',
  joined_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(member_id, group_id),
  UNIQUE(group_id, payout_position)
);

-- ============================================================
-- KYC APPLICATIONS
-- ============================================================
CREATE TABLE kyc_applications (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  full_name               TEXT NOT NULL,
  phone                   TEXT NOT NULL,
  email                   TEXT,
  date_of_birth           DATE,
  occupation              TEXT,
  residential_address     TEXT,
  ghana_card_number       TEXT NOT NULL,
  ghana_card_front_url    TEXT,
  ghana_card_back_url     TEXT,
  selected_group_id       UUID NOT NULL REFERENCES susu_groups(id),
  mobile_money_number     TEXT,
  mobile_money_provider   TEXT,
  bank_name               TEXT,
  bank_account_number     TEXT,
  bank_account_name       TEXT,
  registration_fee_paid   BOOLEAN DEFAULT false,
  registration_fee_ref    TEXT,
  registration_fee_amount DECIMAL(10,2),
  status                  kyc_status DEFAULT 'pending',
  rejection_reason        TEXT,
  reviewer_id             UUID REFERENCES admin_users(id),
  created_member_id       UUID REFERENCES members(id),
  submitted_at            TIMESTAMPTZ DEFAULT NOW(),
  reviewed_at             TIMESTAMPTZ
);

-- ============================================================
-- CONTRIBUTIONS
-- ============================================================
CREATE TABLE contributions (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  member_id     UUID NOT NULL REFERENCES members(id),
  group_id      UUID NOT NULL REFERENCES susu_groups(id),
  membership_id UUID NOT NULL REFERENCES group_memberships(id),
  amount        DECIMAL(10,2) NOT NULL,
  due_date      DATE NOT NULL,
  paid_at       TIMESTAMPTZ,
  status        contribution_status DEFAULT 'pending',
  paystack_ref  TEXT,
  paystack_data JSONB,
  cycle_number  INTEGER NOT NULL DEFAULT 1,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- PAYOUTS
-- ============================================================
CREATE TABLE payouts (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  member_id           UUID NOT NULL REFERENCES members(id),
  group_id            UUID NOT NULL REFERENCES susu_groups(id),
  membership_id       UUID NOT NULL REFERENCES group_memberships(id),
  total_amount        DECIMAL(10,2) NOT NULL,
  scheduled_date      DATE NOT NULL,
  paid_at             TIMESTAMPTZ,
  status              payout_status DEFAULT 'upcoming',
  paystack_transfer_ref TEXT,
  notes               TEXT,
  marked_paid_by      UUID REFERENCES admin_users(id),
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TRANSACTIONS (audit log)
-- ============================================================
CREATE TABLE transactions (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  member_id    UUID REFERENCES members(id),
  type         tx_type NOT NULL,
  amount       DECIMAL(10,2) NOT NULL,
  reference    TEXT UNIQUE NOT NULL,
  description  TEXT,
  status       tx_status DEFAULT 'pending',
  paystack_data JSONB,
  related_id   UUID,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ANNOUNCEMENTS
-- ============================================================
CREATE TABLE announcements (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title      TEXT NOT NULL,
  content    TEXT NOT NULL,
  group_id   UUID REFERENCES susu_groups(id),
  is_global  BOOLEAN DEFAULT false,
  created_by UUID NOT NULL REFERENCES admin_users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- NOTIFICATIONS
-- ============================================================
CREATE TABLE notifications (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  member_id     UUID NOT NULL REFERENCES members(id),
  type          notif_type NOT NULL,
  message       TEXT NOT NULL,
  status        notif_status DEFAULT 'pending',
  sent_at       TIMESTAMPTZ,
  error_message TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX idx_members_phone        ON members(phone);
CREATE INDEX idx_members_status       ON members(status);
CREATE INDEX idx_members_member_id    ON members(member_id);
CREATE INDEX idx_memberships_member   ON group_memberships(member_id);
CREATE INDEX idx_memberships_group    ON group_memberships(group_id);
CREATE INDEX idx_contributions_member ON contributions(member_id);
CREATE INDEX idx_contributions_status ON contributions(status);
CREATE INDEX idx_contributions_due    ON contributions(due_date);
CREATE INDEX idx_contributions_group  ON contributions(group_id);
CREATE INDEX idx_payouts_member       ON payouts(member_id);
CREATE INDEX idx_payouts_status       ON payouts(status);
CREATE INDEX idx_payouts_date         ON payouts(scheduled_date);
CREATE INDEX idx_transactions_member  ON transactions(member_id);
CREATE INDEX idx_transactions_ref     ON transactions(reference);
CREATE INDEX idx_kyc_status           ON kyc_applications(status);
CREATE INDEX idx_notifs_member        ON notifications(member_id);

-- ============================================================
-- updated_at TRIGGER
-- ============================================================
CREATE OR REPLACE FUNCTION fn_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_admin_users_updated_at   BEFORE UPDATE ON admin_users      FOR EACH ROW EXECUTE FUNCTION fn_updated_at();
CREATE TRIGGER trg_members_updated_at       BEFORE UPDATE ON members           FOR EACH ROW EXECUTE FUNCTION fn_updated_at();
CREATE TRIGGER trg_groups_updated_at        BEFORE UPDATE ON susu_groups       FOR EACH ROW EXECUTE FUNCTION fn_updated_at();
CREATE TRIGGER trg_memberships_updated_at   BEFORE UPDATE ON group_memberships FOR EACH ROW EXECUTE FUNCTION fn_updated_at();
CREATE TRIGGER trg_contributions_updated_at BEFORE UPDATE ON contributions      FOR EACH ROW EXECUTE FUNCTION fn_updated_at();
CREATE TRIGGER trg_payouts_updated_at       BEFORE UPDATE ON payouts           FOR EACH ROW EXECUTE FUNCTION fn_updated_at();

-- ============================================================
-- GROUP MEMBER COUNT TRIGGER
-- ============================================================
CREATE OR REPLACE FUNCTION fn_group_member_count()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE susu_groups
    SET current_members = current_members + 1,
        status = CASE
          WHEN current_members + 1 >= max_members AND status = 'open' THEN 'full'
          ELSE status
        END
    WHERE id = NEW.group_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE susu_groups
    SET current_members = GREATEST(current_members - 1, 0),
        status = CASE
          WHEN status = 'full' THEN 'open'
          ELSE status
        END
    WHERE id = OLD.group_id;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_group_member_count
  AFTER INSERT OR DELETE ON group_memberships
  FOR EACH ROW EXECUTE FUNCTION fn_group_member_count();

-- ============================================================
-- VERIFY MEMBER PASSCODE (used by auth edge function)
-- ============================================================
CREATE OR REPLACE FUNCTION verify_member_passcode(p_phone TEXT, p_passcode TEXT)
RETURNS TABLE (
  id UUID, member_id TEXT, full_name TEXT,
  phone TEXT, status member_status, whatsapp_number TEXT
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT m.id, m.member_id, m.full_name, m.phone, m.status, m.whatsapp_number
  FROM members m
  WHERE m.phone = p_phone
    AND m.passcode_hash = crypt(p_passcode, m.passcode_hash)
    AND m.status = 'active';
END;
$$;

-- ============================================================
-- VERIFY ADMIN PASSWORD
-- ============================================================
CREATE OR REPLACE FUNCTION verify_admin_password(p_email TEXT, p_password TEXT)
RETURNS TABLE (id UUID, email TEXT, full_name TEXT, role TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT a.id, a.email, a.full_name, a.role
  FROM admin_users a
  WHERE a.email = p_email
    AND a.password_hash = crypt(p_password, a.password_hash)
    AND a.is_active = true;
END;
$$;

-- ============================================================
-- GENERATE CONTRIBUTION SCHEDULE (called when admin activates group)
-- ============================================================
CREATE OR REPLACE FUNCTION activate_group(p_group_id UUID, p_start_date DATE)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_group   susu_groups%ROWTYPE;
  v_mem     group_memberships%ROWTYPE;
  v_payout_amount DECIMAL(10,2);
  v_total_days INTEGER;
BEGIN
  SELECT * INTO v_group FROM susu_groups WHERE id = p_group_id;

  IF v_group.id IS NULL THEN
    RAISE EXCEPTION 'Group not found';
  END IF;

  v_payout_amount := v_group.contribution_amount * v_group.max_members * v_group.cycle_days;
  v_total_days    := v_group.max_members * v_group.cycle_days;

  -- Set group start date
  UPDATE susu_groups
  SET start_date = p_start_date,
      end_date   = p_start_date + v_total_days,
      status     = 'active'
  WHERE id = p_group_id;

  -- For each member in position order: set payout date + generate contributions
  FOR v_mem IN
    SELECT * FROM group_memberships
    WHERE group_id = p_group_id AND status = 'active'
    ORDER BY payout_position
  LOOP
    -- Set payout date and expected amount
    UPDATE group_memberships
    SET payout_date   = p_start_date + (v_mem.payout_position * v_group.cycle_days),
        payout_amount = v_payout_amount
    WHERE id = v_mem.id;

    -- Create payout record
    INSERT INTO payouts (member_id, group_id, membership_id, total_amount, scheduled_date, status)
    VALUES (
      v_mem.member_id, p_group_id, v_mem.id, v_payout_amount,
      p_start_date + (v_mem.payout_position * v_group.cycle_days),
      'upcoming'
    );

    -- Generate daily contribution rows for the full group duration
    FOR i IN 0..(v_total_days - 1) LOOP
      INSERT INTO contributions (
        member_id, group_id, membership_id, amount,
        due_date, status, cycle_number
      ) VALUES (
        v_mem.member_id, p_group_id, v_mem.id,
        v_group.contribution_amount,
        p_start_date + i,
        'pending',
        FLOOR(i::FLOAT / v_group.cycle_days) + 1
      );
    END LOOP;
  END LOOP;
END;
$$;

-- ============================================================
-- MARK OVERDUE CONTRIBUTIONS (run daily via cron or webhook)
-- ============================================================
CREATE OR REPLACE FUNCTION mark_overdue_contributions()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE updated_count INTEGER;
BEGIN
  UPDATE contributions
  SET status = 'overdue'
  WHERE status = 'pending' AND due_date < CURRENT_DATE;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE admin_users        ENABLE ROW LEVEL SECURITY;
ALTER TABLE members            ENABLE ROW LEVEL SECURITY;
ALTER TABLE susu_groups        ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_memberships  ENABLE ROW LEVEL SECURITY;
ALTER TABLE kyc_applications   ENABLE ROW LEVEL SECURITY;
ALTER TABLE contributions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE payouts            ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcements      ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications      ENABLE ROW LEVEL SECURITY;

-- Public can read open/active groups
CREATE POLICY "public_read_groups" ON susu_groups
  FOR SELECT USING (status IN ('open','full','active'));

-- All other access is via Edge Functions using service_role key
-- (service_role bypasses RLS — safe because only our functions use it)

-- ============================================================
-- SEED: Default super admin
-- Change password immediately after first login!
-- ============================================================
INSERT INTO admin_users (email, password_hash, full_name, role)
VALUES (
  'admin@susuplatform.com',
  crypt('Admin@1234', gen_salt('bf')),
  'Platform Admin',
  'super_admin'
);

-- ============================================================
-- HASH PASSCODE (used by kyc-review function)
-- ============================================================
CREATE OR REPLACE FUNCTION hash_passcode(p_passcode TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN crypt(p_passcode, gen_salt('bf'));
END;
$$;
