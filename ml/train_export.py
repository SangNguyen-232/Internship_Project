"""
Generate CSV (temperature, humidity, soil_moisture, final_label),
train a small Keras model, export float32 TFLite,
and write ../include/dht_anomaly_model.h.

Thresholds MUST match include/risk_label.h (copy kept in sync below).
"""
from __future__ import annotations

import csv
import os
import sys

import numpy as np
import contextlib

# --- Sync with include/risk_label.h ---

def led_state_from_temperature(t: float) -> int:
    if t >= 50.0:
        return 3
    if t >= 35.0:
        return 2
    return 1


def neo_state_from_humidity(h: float) -> int:
    if h >= 95.0:
        return 3
    if h >= 75.0:
        return 2
    return 1


def soil_state_from_moisture(s: float) -> int:
    if s < 20.0 or s > 90.0:
        return 3
    if s < 40.0 or s > 80.0:
        return 2
    return 1


def final_label(t: float, h: float, s: float) -> int:
    a = led_state_from_temperature(t)
    b = neo_state_from_humidity(h)
    c = soil_state_from_moisture(s)
    return max(a, b, c)


def build_dataset(
    rng: np.random.Generator, n_extra: int = 4000
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    rows: list[tuple[float, float, float, int]] = []

    # 3-D grid near all decision boundaries
    # Temperature boundaries: 35, 50
    # Humidity boundaries:    75, 95
    # Soil boundaries:        20, 40, 80, 90
    for t in np.linspace(10.0, 55.0, 15):
        for h in np.linspace(20.0, 100.0, 15):
            for s in np.linspace(0.0, 100.0, 15):
                for _ in range(2):
                    tt = float(t + rng.normal(0, 0.25))
                    hh = float(h + rng.normal(0, 0.75))
                    ss = float(np.clip(s + rng.normal(0, 1.0), 0.0, 100.0))
                    y = final_label(tt, hh, ss)
                    rows.append((tt, hh, ss, y))

    # Extra random coverage
    for _ in range(n_extra):
        tt = float(rng.uniform(10.0, 55.0))
        hh = float(rng.uniform(20.0, 100.0))
        ss = float(rng.uniform(0.0, 100.0))
        rows.append((tt, hh, ss, final_label(tt, hh, ss)))

    xs = np.array([[r[0], r[1], r[2]] for r in rows], dtype=np.float32)
    ys = np.array([r[3] for r in rows], dtype=np.int32)
    ys0 = ys - 1  # Keras sparse labels 0..2
    return xs, ys, ys0


def write_csv(path: str, xs: np.ndarray, ys: np.ndarray) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["temperature", "humidity", "soil_moisture", "final_label"])
        for (t, h, s), lab in zip(xs, ys):
            w.writerow([f"{t:.4f}", f"{h:.4f}", f"{s:.4f}", int(lab)])


def tflite_to_header(tflite_bytes: bytes, out_path: str) -> None:
    lines = ["#pragma once", "", "const unsigned char dht_anomaly_model_tflite[] = {"]
    row: list[str] = []
    for i, b in enumerate(tflite_bytes):
        row.append(f"0x{b:02x}")
        if len(row) == 12:
            lines.append("  " + ", ".join(row) + ",")
            row = []
    if row:
        lines.append("  " + ", ".join(row) + ",")
    lines.append("};")
    lines.append("")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))


def main() -> int:
    root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    csv_path    = os.path.join(root, "ml",      "dataset.csv")
    header_path = os.path.join(root, "include", "dht_anomaly_model.h")
    tflite_path = os.path.join(root, "ml",      "dht_risk_model.tflite")

    rng = np.random.default_rng(42)
    xs, ys, ys0 = build_dataset(rng)
    write_csv(csv_path, xs, ys)
    print(f"Wrote {csv_path} ({len(xs)} rows)")

    try:
        os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")
        os.environ.setdefault("TF_ENABLE_ONEDNN_OPTS", "0")
        import tensorflow as tf
        tf.get_logger().setLevel("ERROR")
    except ImportError:
        print("TensorFlow not installed. Run: pip install -r ml/requirements.txt", file=sys.stderr)
        return 1

    n = len(xs)
    idx = rng.permutation(n)
    split = int(n * 0.85)
    tr, va = idx[:split], idx[split:]

    model = tf.keras.Sequential(
        [
            tf.keras.layers.Input(shape=(3,)),          # temperature, humidity, soil_moisture
            tf.keras.layers.Dense(24, activation="relu"),
            tf.keras.layers.Dense(16, activation="relu"),
            tf.keras.layers.Dense(3,  activation="softmax"),
        ]
    )
    model.compile(
        optimizer=tf.keras.optimizers.Adam(0.002),
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"],
    )
    early = tf.keras.callbacks.EarlyStopping(
        monitor="val_accuracy",
        mode="max",
        patience=15,
        restore_best_weights=True,
        verbose=1,
    )

    loss_before, acc_before = model.evaluate(xs[va], ys0[va], verbose=0)
    print(f"Accuracy before training: val_accuracy={acc_before:.4f}, val_loss={loss_before:.4f}")

    model.fit(
        xs[tr], ys0[tr],
        validation_data=(xs[va], ys0[va]),
        epochs=50,
        batch_size=64,
        verbose=1,
        callbacks=[early],
    )

    loss_after, acc_after = model.evaluate(xs[va], ys0[va], verbose=0)
    print(f"Accuracy after training: val_accuracy={acc_after:.4f}, val_loss={loss_after:.4f}")

    import logging
    logging.getLogger("absl").setLevel(logging.ERROR)

    converter = tf.lite.TFLiteConverter.from_keras_model(model)
    converter.optimizations = []
    with open(os.devnull, "w") as f, contextlib.redirect_stdout(f):
        tflite_model = converter.convert()

    with open(tflite_path, "wb") as f:
        f.write(tflite_model)
    print(f"Wrote {tflite_path} ({len(tflite_model)} bytes)")

    tflite_to_header(tflite_model, header_path)
    print(f"Wrote {header_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())