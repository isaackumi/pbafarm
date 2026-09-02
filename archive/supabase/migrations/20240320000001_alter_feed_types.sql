-- Add new columns to feed_types table
ALTER TABLE feed_types
ADD COLUMN IF NOT EXISTS current_stock DECIMAL(10,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS minimum_stock DECIMAL(10,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS description TEXT;

-- Update existing records to have default values
UPDATE feed_types
SET current_stock = 0,
    minimum_stock = 0
WHERE current_stock IS NULL OR minimum_stock IS NULL;

-- Create feed_purchases table
CREATE TABLE IF NOT EXISTS feed_purchases (
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

-- Create feed_usage table
CREATE TABLE IF NOT EXISTS feed_usage (
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
DROP TRIGGER IF EXISTS feed_stock_update_on_purchase ON feed_purchases;
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
DROP TRIGGER IF EXISTS feed_stock_update_on_usage ON feed_usage;
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
DROP TRIGGER IF EXISTS feed_low_stock_check ON feed_types;
CREATE TRIGGER feed_low_stock_check
    AFTER UPDATE OF current_stock ON feed_types
    FOR EACH ROW
    EXECUTE FUNCTION check_feed_low_stock();

-- Row Level Security Policies
ALTER TABLE feed_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE feed_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE feed_usage ENABLE ROW LEVEL SECURITY;

-- Feed Types Policies
DROP POLICY IF EXISTS "Allow read access for all users" ON feed_types;
CREATE POLICY "Allow read access for all users" ON feed_types
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow insert for authenticated users" ON feed_types;
CREATE POLICY "Allow insert for authenticated users" ON feed_types
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Allow update for authenticated users" ON feed_types;
CREATE POLICY "Allow update for authenticated users" ON feed_types
    FOR UPDATE USING (auth.role() = 'authenticated');

-- Feed Purchases Policies
DROP POLICY IF EXISTS "Allow read access for all users" ON feed_purchases;
CREATE POLICY "Allow read access for all users" ON feed_purchases
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow insert for authenticated users" ON feed_purchases;
CREATE POLICY "Allow insert for authenticated users" ON feed_purchases
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Allow update for authenticated users" ON feed_purchases;
CREATE POLICY "Allow update for authenticated users" ON feed_purchases
    FOR UPDATE USING (auth.role() = 'authenticated');

-- Feed Usage Policies
DROP POLICY IF EXISTS "Allow read access for all users" ON feed_usage;
CREATE POLICY "Allow read access for all users" ON feed_usage
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow insert for authenticated users" ON feed_usage;
CREATE POLICY "Allow insert for authenticated users" ON feed_usage
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Allow update for authenticated users" ON feed_usage;
CREATE POLICY "Allow update for authenticated users" ON feed_usage
    FOR UPDATE USING (auth.role() = 'authenticated'); 