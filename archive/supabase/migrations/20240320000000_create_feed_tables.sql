-- Create feed_types table if it doesn't exist
CREATE TABLE IF NOT EXISTS feed_types (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    current_stock DECIMAL(10,2) DEFAULT 0,
    minimum_stock DECIMAL(10,2) DEFAULT 0,
    price_per_kg DECIMAL(10,2),
    supplier_id UUID REFERENCES feed_suppliers(id),
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    deleted_at TIMESTAMP WITH TIME ZONE
);

-- Create feed_purchases table
CREATE TABLE IF NOT EXISTS feed_purchases (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    feed_type_id UUID REFERENCES feed_types(id) NOT NULL,
    quantity DECIMAL(10,2) NOT NULL,
    price_per_kg DECIMAL(10,2) NOT NULL,
    purchase_date DATE NOT NULL,
    supplier_id UUID REFERENCES feed_suppliers(id),
    batch_number TEXT,
    expiry_date DATE,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    deleted_at TIMESTAMP WITH TIME ZONE
);

-- Create feed_usage table
CREATE TABLE IF NOT EXISTS feed_usage (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    feed_type_id UUID REFERENCES feed_types(id) NOT NULL,
    cage_id UUID REFERENCES cages(id) NOT NULL,
    quantity DECIMAL(10,2) NOT NULL,
    usage_date DATE NOT NULL,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    deleted_at TIMESTAMP WITH TIME ZONE
);

-- Create function to update feed stock on purchase
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

-- Create trigger for feed stock update on purchase
CREATE TRIGGER update_feed_stock_on_purchase
    AFTER INSERT ON feed_purchases
    FOR EACH ROW
    EXECUTE FUNCTION update_feed_stock_on_purchase();

-- Create function to update feed stock on usage
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

-- Create trigger for feed stock update on usage
CREATE TRIGGER update_feed_stock_on_usage
    AFTER INSERT ON feed_usage
    FOR EACH ROW
    EXECUTE FUNCTION update_feed_stock_on_usage();

-- Create function to check low stock
CREATE OR REPLACE FUNCTION check_low_stock()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.current_stock <= NEW.minimum_stock THEN
        -- You can add notification logic here
        RAISE NOTICE 'Low stock alert for feed type %: % kg remaining', NEW.name, NEW.current_stock;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for low stock check
CREATE TRIGGER check_low_stock
    AFTER UPDATE OF current_stock ON feed_types
    FOR EACH ROW
    EXECUTE FUNCTION check_low_stock();

-- Add RLS policies
ALTER TABLE feed_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE feed_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE feed_usage ENABLE ROW LEVEL SECURITY;

-- Create policies for feed_types
CREATE POLICY "Enable read access for all users" ON feed_types
    FOR SELECT USING (true);

CREATE POLICY "Enable insert for authenticated users" ON feed_types
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Enable update for authenticated users" ON feed_types
    FOR UPDATE USING (auth.role() = 'authenticated');

-- Create policies for feed_purchases
CREATE POLICY "Enable read access for all users" ON feed_purchases
    FOR SELECT USING (true);

CREATE POLICY "Enable insert for authenticated users" ON feed_purchases
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Enable update for authenticated users" ON feed_purchases
    FOR UPDATE USING (auth.role() = 'authenticated');

-- Create policies for feed_usage
CREATE POLICY "Enable read access for all users" ON feed_usage
    FOR SELECT USING (true);

CREATE POLICY "Enable insert for authenticated users" ON feed_usage
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Enable update for authenticated users" ON feed_usage
    FOR UPDATE USING (auth.role() = 'authenticated'); 