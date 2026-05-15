-- Stored functions for atomic bet placement and settlement.
-- Each call is a single round-trip to Neon; previously each operation was
-- 5–6 round-trips (BEGIN, INSERTs, UPDATEs, COMMIT). At ~150ms RTT the
-- difference is ~1s per bet.
--
-- Idempotency: callers pass an idempotency_key. If the key already exists,
-- the unique constraint on transactions.idempotency_key surfaces SQLSTATE
-- 23505, which the caller maps to a no-op.
--
-- Insufficient funds is signaled by RAISE EXCEPTION with SQLSTATE 'P0001'
-- and message 'INSUFFICIENT_FUNDS'.

-- Dropped + recreated whenever the signature changes. CREATE OR REPLACE
-- can't change return types, so we drop first to keep this idempotent
-- across schema evolutions.
DROP FUNCTION IF EXISTS place_bet CASCADE;

CREATE FUNCTION place_bet(
  p_idempotency_key text,
  p_user_account_id uuid,
  p_escrow_account_id uuid,
  p_amount numeric,
  p_bet_id text,
  p_round_id integer,
  p_column text,
  OUT new_balance numeric,
  OUT new_total_wagered numeric
)
LANGUAGE plpgsql AS $$
DECLARE
  v_tx_id uuid;
  v_user_id uuid;
BEGIN
  -- Conditionally debit user. If the WHERE filters the row out (insufficient
  -- funds), new_balance stays NULL and we raise. We also pull user_id off the
  -- same row so we can update users.total_wagered without a second SELECT.
  UPDATE accounts
  SET balance = balance - p_amount
  WHERE id = p_user_account_id AND balance >= p_amount
  RETURNING balance, user_id INTO new_balance, v_user_id;

  IF new_balance IS NULL THEN
    RAISE EXCEPTION 'INSUFFICIENT_FUNDS' USING ERRCODE = 'P0001';
  END IF;

  UPDATE accounts SET balance = balance + p_amount WHERE id = p_escrow_account_id;

  -- Lifetime wager accumulator — drives the leveling curve. Updated in the
  -- same SQL function as the ledger writes so it can never diverge from the
  -- sum of `bet`-kind transactions.
  UPDATE users
  SET total_wagered = total_wagered + p_amount
  WHERE id = v_user_id
  RETURNING total_wagered INTO new_total_wagered;

  INSERT INTO transactions (idempotency_key, kind, reference_id, metadata)
  VALUES (
    p_idempotency_key,
    'bet',
    p_bet_id,
    jsonb_build_object('roundId', p_round_id, 'column', p_column)
  )
  RETURNING id INTO v_tx_id;

  INSERT INTO entries (transaction_id, account_id, direction, amount) VALUES
    (v_tx_id, p_user_account_id, 'debit', p_amount),
    (v_tx_id, p_escrow_account_id, 'credit', p_amount);
END;
$$;


CREATE OR REPLACE FUNCTION settle_bet(
  p_idempotency_key text,
  p_user_account_id uuid,
  p_escrow_account_id uuid,
  p_house_account_id uuid,
  p_stake numeric,
  p_winnings numeric,   -- ignored if not won
  p_won boolean,
  p_bet_id text,
  p_round_id integer
) RETURNS numeric        -- new user balance, or NULL on a loss (unchanged)
LANGUAGE plpgsql AS $$
DECLARE
  v_tx_id uuid;
  v_new_balance numeric;
  v_payout numeric;
BEGIN
  IF p_won THEN
    v_payout := p_stake + p_winnings;

    UPDATE accounts SET balance = balance - p_stake    WHERE id = p_escrow_account_id;
    UPDATE accounts SET balance = balance - p_winnings WHERE id = p_house_account_id;
    UPDATE accounts SET balance = balance + v_payout   WHERE id = p_user_account_id
      RETURNING balance INTO v_new_balance;

    INSERT INTO transactions (idempotency_key, kind, reference_id, metadata)
    VALUES (
      p_idempotency_key,
      'payout',
      p_bet_id,
      jsonb_build_object('roundId', p_round_id, 'won', true)
    )
    RETURNING id INTO v_tx_id;

    INSERT INTO entries (transaction_id, account_id, direction, amount) VALUES
      (v_tx_id, p_escrow_account_id, 'debit',  p_stake),
      (v_tx_id, p_house_account_id,  'debit',  p_winnings),
      (v_tx_id, p_user_account_id,   'credit', v_payout);

    RETURN v_new_balance;
  ELSE
    UPDATE accounts SET balance = balance - p_stake WHERE id = p_escrow_account_id;
    UPDATE accounts SET balance = balance + p_stake WHERE id = p_house_account_id;

    INSERT INTO transactions (idempotency_key, kind, reference_id, metadata)
    VALUES (
      p_idempotency_key,
      'payout',
      p_bet_id,
      jsonb_build_object('roundId', p_round_id, 'won', false)
    )
    RETURNING id INTO v_tx_id;

    INSERT INTO entries (transaction_id, account_id, direction, amount) VALUES
      (v_tx_id, p_escrow_account_id, 'debit',  p_stake),
      (v_tx_id, p_house_account_id,  'credit', p_stake);

    RETURN NULL;
  END IF;
END;
$$;
