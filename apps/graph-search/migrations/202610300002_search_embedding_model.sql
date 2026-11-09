-- The model and vector dimension every stored search vector was encoded with.
-- Startup records it once and refuses to run against a different model.
CREATE TABLE search.embedding_model (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    model text NOT NULL,
    dimension integer NOT NULL CHECK (dimension > 0)
);
