-- Limpeza segura da transação atual em caso de Reset de Demonstração
DELETE FROM door_events;
DELETE FROM payments;
DELETE FROM rentals;
DELETE FROM doors;
DELETE FROM items;
DELETE FROM lockers;
DELETE FROM users;

-- 1. Usuários Padrão para Demonstração Rápida
INSERT INTO users (id, name, ra, email, role) VALUES
('usr-student-01', 'Lucas Andrade', '20261045', 'lucas.andrade@faculdade.edu.br', 'STUDENT'),
('usr-student-02', 'Beatriz Silva', '20262089', 'beatriz.silva@faculdade.edu.br', 'STUDENT'),
('usr-admin-01',   'Mariana Costa (Admin)', 'ADM001', 'mariana.admin@faculdade.edu.br', 'ADMIN');

-- 2. Armários Inteligentes por Bloco
INSERT INTO lockers (id, code, name, building_location, is_online) VALUES
('locker-bloco-b', 'BLOCO-B-01', 'Armário Bloco B — Laboratórios e Saúde', 'Corredor Principal Térreo (Ao lado do Lab. Química)', 1),
('locker-bloco-a', 'BLOCO-A-01', 'Armário Bloco A — Engenharias e Exatas', 'Hall dos Elevadores 1º Andar', 1);

-- 3. Catálogo de Objetos (Valores em Centavos: R$ 2,00 = 200)
INSERT INTO items (id, sku, name, category, description, hourly_price_cents, daily_price_cents, requires_preparation) VALUES
('itm-01', 'CALC-CASIO-01', 'Calculadora Científica Casio fx-82MS', 'EXATAS', '240 funções, aprovada para provas de Engenharia e Cálculo.', 200, 800, 0),
('itm-02', 'JALECO-LAB-01', 'Jaleco Manga Longa Branco (Tam. M/G)', 'SAUDE', '100% algodão com punho elástico para aulas de laboratório.', 400, 1200, 1),
('itm-03', 'PWR-BANK-01',   'Powerbank 10.000mAh Turbo Fast Charge', 'ENERGIA', 'Cabos USB-C e Lightning integrados. Carga completa.', 300, 1000, 1),
('itm-04', 'CHARGER-65W-01','Carregador Rápido USB-C GaN 65W', 'ENERGIA', 'Compatível com notebooks USB-C e smartphones.', 300, 1000, 0),
('itm-05', 'CALC-CASIO-02', 'Calculadora Científica Casio fx-82MS #2', 'EXATAS', '240 funções, bateria revisada.', 200, 800, 0),
('itm-06', 'PWR-BANK-02',   'Powerbank 10.000mAh Turbo #2', 'ENERGIA', 'Cabos USB-C e Lightning integrados.', 300, 1000, 1);

-- 4. Portas Numeradas Vinculadas 1:1 aos Objetos (RN01)
INSERT INTO doors (id, locker_id, door_number, item_id, status, lock_state) VALUES
('door-b-01', 'locker-bloco-b', 1, 'itm-01', 'AVAILABLE', 'LOCKED'),
('door-b-02', 'locker-bloco-b', 2, 'itm-02', 'AVAILABLE', 'LOCKED'),
('door-b-03', 'locker-bloco-b', 3, 'itm-03', 'AVAILABLE', 'LOCKED'),
('door-b-04', 'locker-bloco-b', 4, 'itm-04', 'AVAILABLE', 'LOCKED'),
('door-a-01', 'locker-bloco-a', 1, 'itm-05', 'AVAILABLE', 'LOCKED'),
('door-a-02', 'locker-bloco-a', 2, 'itm-06', 'AVAILABLE', 'LOCKED');
