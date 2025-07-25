-- First, drop all existing tables (in proper order to respect foreign key constraints)
DROP TABLE IF EXISTS audit_logs CASCADE;
DROP TABLE IF EXISTS user_roles CASCADE;
DROP TABLE IF EXISTS role_permissions CASCADE;
DROP TABLE IF EXISTS permissions CASCADE;
DROP TABLE IF EXISTS roles CASCADE;
DROP TABLE IF EXISTS topup_history CASCADE;
DROP TABLE IF EXISTS stocking_history CASCADE;
DROP TABLE IF EXISTS feed_inventory_transactions CASCADE;
DROP TABLE IF EXISTS feed_inventory CASCADE;
DROP TABLE IF EXISTS feed_types CASCADE;
DROP TABLE IF EXISTS feed_suppliers CASCADE;
DROP TABLE IF EXISTS harvest_records CASCADE;
DROP TABLE IF EXISTS biweekly_records CASCADE;
DROP TABLE IF EXISTS daily_records CASCADE;
DROP TABLE IF EXISTS cages CASCADE;
DROP TABLE IF EXISTS profiles CASCADE;

-- Drop any existing functions, triggers, and views
DROP FUNCTION IF EXISTS process_audit_log() CASCADE;
DROP FUNCTION IF EXISTS create_stocking_history_if_not_exists() CASCADE;
DROP FUNCTION IF EXISTS get_last_used_feed_type(UUID) CASCADE;
DROP VIEW IF EXISTS active_cages_with_latest_abw CASCADE;
DROP PROCEDURE IF EXISTS migrate_demo_data() CASCADE;

-- Create extension for UUID generation if not exists
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Profiles table (linked to auth.users)
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  email TEXT,
  full_name TEXT,
  role TEXT DEFAULT 'user' CHECK (role IN ('user', 'admin', 'super_admin')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Cages table
CREATE TABLE cages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  location TEXT,
  size NUMERIC(10, 2),
  capacity INTEGER,
  dimensions TEXT,
  material TEXT,
  installation_date DATE,
  stocking_date DATE,
  initial_count INTEGER,
  initial_abw NUMERIC(10, 2),
  initial_biomass NUMERIC(10, 2),
  status TEXT DEFAULT 'empty' CHECK (status IN ('active', 'harvested', 'harvesting', 'maintenance', 'fallow', 'empty')),
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Feed suppliers table
CREATE TABLE feed_suppliers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  abbreviation TEXT,
  contact_info TEXT,
  website TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
);

-- Feed types table
CREATE TABLE feed_types (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  current_stock DECIMAL(10,2) DEFAULT 0,
  minimum_stock DECIMAL(10,2) DEFAULT 0,
  price_per_kg DECIMAL(10,2) NOT NULL,
  supplier_id UUID REFERENCES feed_suppliers(id),
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE
);

-- Feed Purchases Table
CREATE TABLE feed_purchases (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    feed_type_id UUID REFERENCES feed_types(id),
    quantity DECIMAL(10,2) NOT NULL,
    price_per_kg DECIMAL(10,2) NOT NULL,
    purchase_date DATE NOT NULL,
    supplier_id UUID REFERENCES feed_suppliers(id),
    batch_number VARCHAR(50),
    expiry_date DATE,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE
);

-- Feed Usage Table
CREATE TABLE feed_usage (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    feed_type_id UUID REFERENCES feed_types(id),
    cage_id UUID REFERENCES cages(id),
    quantity DECIMAL(10,2) NOT NULL,
    usage_date DATE NOT NULL,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE
);

-- Daily records table
CREATE TABLE daily_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cage_id UUID REFERENCES cages(id) NOT NULL,
  date DATE NOT NULL,
  feed_amount NUMERIC(10, 2) NOT NULL,
  feed_type_id UUID REFERENCES feed_types(id),
  feed_type TEXT,
  feed_price NUMERIC(10, 2) NOT NULL,
  feed_cost NUMERIC(10, 2) NOT NULL,
  mortality INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Bi-weekly Records Table
CREATE TABLE biweekly_records (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    cage_id UUID REFERENCES cages(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    batch_code VARCHAR(20) NOT NULL UNIQUE,
    average_body_weight DECIMAL(10,2) NOT NULL,
    total_fish_count INTEGER NOT NULL,
    total_weight DECIMAL(10,2) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by UUID REFERENCES auth.users(id),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_by UUID REFERENCES auth.users(id)
);

-- Bi-weekly Sampling Table
CREATE TABLE biweekly_sampling (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    biweekly_record_id UUID REFERENCES biweekly_records(id) ON DELETE CASCADE,
    sampling_number INTEGER NOT NULL,
    fish_count INTEGER NOT NULL,
    total_weight DECIMAL(10,2) NOT NULL,
    average_body_weight DECIMAL(10,2) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by UUID REFERENCES auth.users(id),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_by UUID REFERENCES auth.users(id)
);

-- Harvest records table
CREATE TABLE harvest_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cage_id UUID REFERENCES cages(id) NOT NULL,
  harvest_date DATE NOT NULL,
  average_body_weight NUMERIC(10, 2) NOT NULL,
  total_weight NUMERIC(10, 2) NOT NULL,
  estimated_count INTEGER NOT NULL,
  fcr NUMERIC(5, 2) NOT NULL,
  size_breakdown JSONB,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  harvest_type TEXT CHECK (harvest_type IN ('complete', 'partial')),
  status TEXT CHECK (status IN ('completed', 'in_progress'))
);

-- Harvest sampling table
CREATE TABLE harvest_sampling (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  harvest_id UUID REFERENCES harvest_records(id) NOT NULL,
  crate_size NUMERIC(10, 2) NOT NULL,
  samples JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by UUID
);

-- Feed inventory table
CREATE TABLE feed_inventory (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  feed_type_id UUID REFERENCES feed_types(id) NOT NULL,
  quantity_kg NUMERIC(10, 2) NOT NULL,
  batch_number TEXT,
  expiry_date DATE,
  location TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Feed inventory transactions
CREATE TABLE feed_inventory_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  feed_type_id UUID REFERENCES feed_types(id) NOT NULL,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('purchase', 'usage', 'adjustment', 'transfer')),
  quantity_kg NUMERIC(10, 2) NOT NULL,
  transaction_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  reference_id UUID,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Stocking history table
CREATE TABLE stocking_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cage_id UUID REFERENCES cages(id) NOT NULL,
  batch_number TEXT NOT NULL,
  stocking_date DATE NOT NULL,
  fish_count INTEGER NOT NULL,
  initial_abw NUMERIC(10, 2) NOT NULL,
  initial_biomass NUMERIC(10, 2) NOT NULL,
  source_location TEXT,
  source_cage TEXT,
  transfer_supervisor TEXT,
  sampling_supervisor TEXT,
  status TEXT DEFAULT 'approved' CHECK (status IN ('pending_approval', 'approved', 'rejected')),
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  approved_by UUID,
  approved_at TIMESTAMP WITH TIME ZONE,
  deleted_at TIMESTAMP WITH TIME ZONE
);

-- Top up history table
CREATE TABLE topup_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  stocking_id UUID REFERENCES stocking_history(id) NOT NULL,
  topup_date DATE NOT NULL,
  fish_count INTEGER NOT NULL,
  abw NUMERIC(10, 2) NOT NULL,
  biomass NUMERIC(10, 2) GENERATED ALWAYS AS ((fish_count * abw) / 1000) STORED,
  source_location TEXT,
  transfer_supervisor TEXT,
  status TEXT DEFAULT 'pending_approval' CHECK (status IN ('pending_approval', 'approved', 'rejected')),
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  approved_by UUID,
  approved_at TIMESTAMP WITH TIME ZONE
);

-- Permissions table
CREATE TABLE permissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Roles table
CREATE TABLE roles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Role permissions junction table
CREATE TABLE role_permissions (
  role_id UUID REFERENCES roles(id) NOT NULL,
  permission_id UUID REFERENCES permissions(id) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (role_id, permission_id)
);

-- User roles junction table
CREATE TABLE user_roles (
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  role_id UUID REFERENCES roles(id) NOT NULL,
  assigned_by UUID REFERENCES auth.users(id),
  assigned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (user_id, role_id)
);

-- Audit logs table
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id),
  action_type TEXT NOT NULL,
  table_name TEXT NOT NULL,
  record_id UUID,
  previous_values JSONB,
  new_values JSONB,
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create RPC function to create stocking_history if not exists
CREATE OR REPLACE FUNCTION create_stocking_history_if_not_exists() 
RETURNS void AS $$
BEGIN
  -- This function is just a placeholder as we've already created the table above
  -- But keep it for backward compatibility with existing code
END;
$$ LANGUAGE plpgsql;

-- Create view for active cages with latest ABW
CREATE OR REPLACE VIEW active_cages_with_latest_abw AS
SELECT 
    c.*,
    br.average_body_weight as latest_abw,
    br.date as last_biweekly_date
FROM cages c
LEFT JOIN LATERAL (
    SELECT 
        average_body_weight,
        date
    FROM biweekly_records
    WHERE cage_id = c.id
    ORDER BY date DESC
    LIMIT 1
) br ON true
WHERE c.status = 'active';

-- Function to get last used feed type for a cage
CREATE OR REPLACE FUNCTION get_last_used_feed_type(cage_id_param UUID)
RETURNS TABLE (
  id UUID,
  name TEXT,
  pellet_size TEXT,
  protein_percentage NUMERIC,
  supplier_name TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    ft.id,
    ft.name,
    ft.pellet_size,
    ft.protein_percentage,
    fs.name AS supplier_name
  FROM
    daily_records dr
  JOIN
    feed_types ft ON dr.feed_type_id = ft.id
  LEFT JOIN
    feed_suppliers fs ON ft.supplier_id = fs.id
  WHERE
    dr.cage_id = cage_id_param
  ORDER BY
    dr.date DESC
  LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- Create database triggers for audit logging
CREATE OR REPLACE FUNCTION process_audit_log()
RETURNS TRIGGER AS $$
DECLARE
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_logs(
      user_id, 
      action_type, 
      table_name, 
      record_id, 
      new_values
    )
    VALUES (
      auth.uid(), 
      'insert', 
      TG_TABLE_NAME, 
      NEW.id, 
      row_to_json(NEW)
    );
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO audit_logs(
      user_id, 
      action_type, 
      table_name, 
      record_id, 
      previous_values, 
      new_values
    )
    VALUES (
      auth.uid(), 
      'update', 
      TG_TABLE_NAME, 
      NEW.id, 
      row_to_json(OLD), 
      row_to_json(NEW)
    );
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO audit_logs(
      user_id, 
      action_type, 
      table_name, 
      record_id, 
      previous_values
    )
    VALUES (
      auth.uid(), 
      'delete', 
      TG_TABLE_NAME, 
      OLD.id, 
      row_to_json(OLD)
    );
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Apply audit trigger to main tables
DO $$
DECLARE
  table_name text;
BEGIN
  FOR table_name IN 
    SELECT tablename 
    FROM pg_tables 
    WHERE schemaname = 'public' 
    AND tablename IN ('cages', 'daily_records', 'biweekly_records', 'harvest_records', 
                     'feed_types', 'stocking_history', 'topup_history')
  LOOP
    EXECUTE format('
      DROP TRIGGER IF EXISTS audit_trigger ON %I;
      CREATE TRIGGER audit_trigger
        AFTER INSERT OR UPDATE OR DELETE ON %I
        FOR EACH ROW EXECUTE FUNCTION process_audit_log();
    ', table_name, table_name);
  END LOOP;
END;
$$;

-- Create procedure for data migration from JSON
CREATE OR REPLACE PROCEDURE migrate_demo_data()
LANGUAGE plpgsql
AS $$
BEGIN
  -- Insert some demo feed suppliers
  INSERT INTO feed_suppliers (name, abbreviation)
  VALUES 
    ('Aqua Feed Solutions', 'AFS'),
    ('Marine Nutrition', 'MN'),
    ('Fish Feed Pro', 'FFP')
  ON CONFLICT DO NOTHING;
  
  -- Insert some demo feed types
  INSERT INTO feed_types (name, supplier_id, pellet_size, protein_percentage, price_per_kg)
  SELECT 
    feed_name, 
    (SELECT id FROM feed_suppliers WHERE abbreviation = supplier ORDER BY id LIMIT 1),
    pellet_size,
    protein,
    price
  FROM (
    VALUES 
      ('Starter Feed', 'AFS', '1.5mm', 45, 1.80),
      ('Grower Feed', 'MN', '3mm', 40, 1.50),
      ('Finisher Feed', 'FFP', '5mm', 35, 1.30)
  ) AS feeds(feed_name, supplier, pellet_size, protein, price)
  ON CONFLICT DO NOTHING;
  
  -- Insert demo cages
  INSERT INTO cages (name, location, size, capacity, status, installation_date)
  VALUES
    ('Cage 1', 'North Pond', 125.0, 3000, 'empty', '2025-01-01'),
    ('Cage 2', 'North Pond', 125.0, 3000, 'empty', '2025-01-01'),
    ('Cage 3', 'South Pond', 150.0, 3500, 'empty', '2025-01-15'),
    ('Cage 4', 'South Pond', 150.0, 3500, 'empty', '2025-01-15'),
    ('Cage 5', 'East Pond', 100.0, 2500, 'empty', '2025-02-01')
  ON CONFLICT DO NOTHING;
  
  -- Create default roles and permissions
  INSERT INTO roles (name, description)
  VALUES 
    ('super_admin', 'Full system access'),
    ('admin', 'System administration'),
    ('manager', 'Farm management'),
    ('user', 'Basic user access')
  ON CONFLICT DO NOTHING;

  -- Insert basic permissions
  INSERT INTO permissions (code, description)
  VALUES
    ('cages.view', 'View cages'),
    ('cages.create', 'Create cages'),
    ('cages.edit', 'Edit cages'),
    ('cages.delete', 'Delete cages'),
    ('daily.view', 'View daily records'),
    ('daily.create', 'Create daily records'),
    ('daily.edit', 'Edit daily records'),
    ('biweekly.view', 'View biweekly records'),
    ('biweekly.create', 'Create biweekly records'),
    ('biweekly.edit', 'Edit biweekly records'),
    ('harvest.view', 'View harvest records'),
    ('harvest.create', 'Create harvest records'),
    ('stocking.view', 'View stocking history'),
    ('stocking.create', 'Create stockings'),
    ('stocking.approve', 'Approve stockings'),
    ('feeds.view', 'View feed types'),
    ('feeds.manage', 'Manage feed types'),
    ('users.view', 'View users'),
    ('users.manage', 'Manage users'),
    ('reports.view', 'View reports'),
    ('reports.export', 'Export data')
  ON CONFLICT DO NOTHING;
  
  -- Assign permissions to roles
  INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id
  FROM roles r, permissions p
  WHERE r.name = 'super_admin'
  ON CONFLICT DO NOTHING;
  
  -- Assign subset of permissions to admin role
  INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id
  FROM roles r, permissions p
  WHERE r.name = 'admin' AND p.code NOT LIKE 'users.%'
  ON CONFLICT DO NOTHING;
END;
$$;

ALTER TABLE cages ADD COLUMN code VARCHAR(10) UNIQUE NOT NULL;
-- Generate sequential codes for existing cages
UPDATE cages SET code = CONCAT('C', LPAD(id::text, 3, '0')) WHERE code IS NULL;

-- Function to update feed stock on purchase
CREATE OR REPLACE FUNCTION update_feed_stock_on_purchase()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE feed_types
    SET current_stock = current_stock + NEW.quantity,
        updated_at = NOW()
    WHERE id = NEW.feed_type_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for feed stock update on purchase
CREATE TRIGGER feed_stock_update_on_purchase
    AFTER INSERT ON feed_purchases
    FOR EACH ROW
    EXECUTE FUNCTION update_feed_stock_on_purchase();

-- Function to update feed stock on usage
CREATE OR REPLACE FUNCTION update_feed_stock_on_usage()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE feed_types
    SET current_stock = current_stock - NEW.quantity,
        updated_at = NOW()
    WHERE id = NEW.feed_type_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for feed stock update on usage
CREATE TRIGGER feed_stock_update_on_usage
    AFTER INSERT ON feed_usage
    FOR EACH ROW
    EXECUTE FUNCTION update_feed_stock_on_usage();

-- Function to check for low stock
CREATE OR REPLACE FUNCTION check_feed_low_stock()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.current_stock < NEW.minimum_stock THEN
        RAISE NOTICE 'Low stock alert for feed type %: Current stock (%) is below minimum stock (%)',
            NEW.name, NEW.current_stock, NEW.minimum_stock;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for low stock check
CREATE TRIGGER feed_low_stock_check
    AFTER UPDATE OF current_stock ON feed_types
    FOR EACH ROW
    EXECUTE FUNCTION check_feed_low_stock();

-- Row Level Security Policies
ALTER TABLE feed_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE feed_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE feed_usage ENABLE ROW LEVEL SECURITY;

-- Feed Types Policies
CREATE POLICY "Allow read access for all users" ON feed_types
    FOR SELECT USING (true);

CREATE POLICY "Allow insert for authenticated users" ON feed_types
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Allow update for authenticated users" ON feed_types
    FOR UPDATE USING (auth.role() = 'authenticated');

-- Feed Purchases Policies
CREATE POLICY "Allow read access for all users" ON feed_purchases
    FOR SELECT USING (true);

CREATE POLICY "Allow insert for authenticated users" ON feed_purchases
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Allow update for authenticated users" ON feed_purchases
    FOR UPDATE USING (auth.role() = 'authenticated');

-- Feed Usage Policies
CREATE POLICY "Allow read access for all users" ON feed_usage
    FOR SELECT USING (true);

CREATE POLICY "Allow insert for authenticated users" ON feed_usage
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Allow update for authenticated users" ON feed_usage
    FOR UPDATE USING (auth.role() = 'authenticated');

-- Add RLS policies for biweekly_records
ALTER TABLE biweekly_records ENABLE ROW LEVEL SECURITY;

-- Create more permissive RLS policies for biweekly_records
-- Allow all authenticated users to view biweekly records
CREATE POLICY "Allow authenticated users to view biweekly records"
    ON biweekly_records FOR SELECT
    USING (auth.role() = 'authenticated');

-- Allow authenticated users to insert biweekly records
CREATE POLICY "Allow authenticated users to insert biweekly records"
    ON biweekly_records FOR INSERT
    WITH CHECK (auth.role() = 'authenticated');

-- Allow users to update their own records or if they have admin/manager roles
CREATE POLICY "Allow users to update biweekly records"
    ON biweekly_records FOR UPDATE
    USING (
        auth.role() = 'authenticated' AND (
            created_by = auth.uid() OR
            auth.uid() IN (
                SELECT user_id FROM user_roles
                WHERE role_id IN (
                    SELECT id FROM roles
                    WHERE name IN ('admin', 'manager', 'super_admin')
                )
            )
        )
    );

-- Allow users to delete their own records or if they have admin/manager roles
CREATE POLICY "Allow users to delete biweekly records"
    ON biweekly_records FOR DELETE
    USING (
        auth.role() = 'authenticated' AND (
            created_by = auth.uid() OR
            auth.uid() IN (
                SELECT user_id FROM user_roles
                WHERE role_id IN (
                    SELECT id FROM roles
                    WHERE name IN ('admin', 'manager', 'super_admin')
                )
            )
        )
    );

-- Add RLS policies for biweekly_sampling
ALTER TABLE biweekly_sampling ENABLE ROW LEVEL SECURITY;

-- Create more permissive RLS policies for biweekly_sampling
-- Allow all authenticated users to view biweekly sampling
CREATE POLICY "Allow authenticated users to view biweekly sampling"
    ON biweekly_sampling FOR SELECT
    USING (auth.role() = 'authenticated');

-- Allow authenticated users to insert biweekly sampling
CREATE POLICY "Allow authenticated users to insert biweekly sampling"
    ON biweekly_sampling FOR INSERT
    WITH CHECK (auth.role() = 'authenticated');

-- Allow users to update their own records or if they have admin/manager roles
CREATE POLICY "Allow users to update biweekly sampling"
    ON biweekly_sampling FOR UPDATE
    USING (
        auth.role() = 'authenticated' AND (
            created_by = auth.uid() OR
            auth.uid() IN (
                SELECT user_id FROM user_roles
                WHERE role_id IN (
                    SELECT id FROM roles
                    WHERE name IN ('admin', 'manager', 'super_admin')
                )
            )
        )
    );

-- Allow users to delete their own records or if they have admin/manager roles
CREATE POLICY "Allow users to delete biweekly sampling"
    ON biweekly_sampling FOR DELETE
    USING (
        auth.role() = 'authenticated' AND (
            created_by = auth.uid() OR
            auth.uid() IN (
                SELECT user_id FROM user_roles
                WHERE role_id IN (
                    SELECT id FROM roles
                    WHERE name IN ('admin', 'manager', 'super_admin')
                )
            )
        )
    );

-- Create indexes for better query performance
CREATE INDEX idx_biweekly_records_cage_id ON biweekly_records(cage_id);
CREATE INDEX idx_biweekly_records_date ON biweekly_records(date);
CREATE INDEX idx_biweekly_records_batch_code ON biweekly_records(batch_code);
CREATE INDEX idx_biweekly_sampling_record_id ON biweekly_sampling(biweekly_record_id);