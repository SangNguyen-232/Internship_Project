from __future__ import annotations

import csv
import os
import sys

import numpy as np
import contextlib

# --- Sync với include/risk_label.h ---

def _score_temperature(t: float) -> float:
    if 20.0 <= t <= 30.0:
        d = abs(t - 25.0)
        return 2.0 + (d / 5.0) * 2.0
    if (15.0 <= t < 20.0) or (30.0 < t <= 35.0):
        d = (20.0 - t) / 5.0 if t < 20.0 else (t - 30.0) / 5.0
        return 5.0 + d * 2.0
    d = (15.0 - t) / 15.0 if t < 15.0 else (t - 35.0) / 20.0
    return 8.0 + min(d, 1.0) * 2.0


def _score_humidity(h: float) -> float:
    if 50.0 <= h <= 70.0:
        d = abs(h - 60.0)
        return 2.0 + (d / 10.0) * 2.0
    if (40.0 <= h < 50.0) or (70.0 < h <= 85.0):
        d = (50.0 - h) / 10.0 if h < 50.0 else (h - 70.0) / 15.0
        return 5.0 + d * 2.0
    d = (40.0 - h) / 40.0 if h < 40.0 else (h - 85.0) / 15.0
    return 8.0 + min(d, 1.0) * 2.0


def _score_soil(s: float) -> float:
    if 60.0 <= s <= 80.0:
        d = abs(s - 70.0)
        return 2.0 + (d / 10.0) * 2.0
    if (40.0 <= s < 60.0) or (80.0 < s <= 90.0):
        d = (60.0 - s) / 20.0 if s < 60.0 else (s - 80.0) / 10.0
        return 5.0 + d * 2.0
    d = (40.0 - s) / 40.0 if s < 40.0 else (s - 90.0) / 10.0
    return 8.0 + min(d, 1.0) * 2.0


def final_label(t: float, h: float, s: float) -> int:
    r = 0.3 * _score_temperature(t) + 0.2 * _score_humidity(h) + 0.5 * _score_soil(s)
    if r <= 4.6:
        return 1
    if r <= 7.3:
        return 2
    return 3


def build_dataset(
    rng: np.random.Generator, n_extra: int = 4000
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    rows: list[tuple[float, float, float, int]] = []

    # Grid quét dày quanh các ngưỡng mới
    # T: 15, 20, 30, 35  |  H: 40, 50, 70, 85  |  S: 40, 60, 80, 90
    for t in np.linspace(5.0, 50.0, 16):
        for h in np.linspace(20.0, 100.0, 16):
            for s in np.linspace(0.0, 100.0, 16):
                for _ in range(2):
                    tt = float(t + rng.normal(0, 0.3))
                    hh = float(h + rng.normal(0, 0.5))
                    ss = float(np.clip(s + rng.normal(0, 0.8), 0.0, 100.0))
                    rows.append((tt, hh, ss, final_label(tt, hh, ss)))

    # Extra random
    for _ in range(n_extra):
        tt = float(rng.uniform(5.0, 50.0))
        hh = float(rng.uniform(20.0, 100.0))
        ss = float(rng.uniform(0.0, 100.0))
        rows.append((tt, hh, ss, final_label(tt, hh, ss)))

    xs = np.array([[r[0], r[1], r[2]] for r in rows], dtype=np.float32)
    ys = np.array([r[3] for r in rows], dtype=np.int32)
    ys0 = ys - 1
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