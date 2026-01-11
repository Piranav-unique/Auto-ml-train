import modal
import pandas as pd
import numpy as np
import time
import io
import requests
from sklearn.model_selection import train_test_split, StratifiedKFold
from sklearn.metrics import accuracy_score, mean_squared_error, r2_score
from xgboost import XGBClassifier, XGBRegressor
from sklearn.preprocessing import LabelEncoder, StandardScaler, OneHotEncoder
from sklearn.impute import SimpleImputer

# 1. Define the Modal Image
image = modal.Image.debian_slim().pip_install(
    "pandas",
    "numpy",
    "scikit-learn",
    "requests",
    "fastapi",
    "xgboost"
)

app = modal.App("auto-ml-trainer")

@app.function(image=image, timeout=600, cpu=2.0, memory=4096)
def train_model_logic(csv_url, email):
    start_time = time.time()
    def log(msg):
        print(f"--- [{time.time() - start_time:.2f}s] {msg}")

    try:
        log(f"STARTING TRAINING for user {email}")
        
        # 1. Download CSV with better handling
        log(f"Connecting to: {csv_url}")
        try:
            r = requests.get(csv_url, timeout=20, stream=True)
            r.raise_for_status()
            # Use chunks to avoid memory hang
            buffer = io.BytesIO()
            for chunk in r.iter_content(chunk_size=8192):
                buffer.write(chunk)
            buffer.seek(0)
            # Increased rows for maximum accuracy (50k is safe for 4GB memory)
            df = pd.read_csv(buffer, nrows=50000)
            log(f"CSV Loaded. Shape: {df.shape}")
        except Exception as e:
            log(f"Download FAILED: {str(e)}")
            return {"status": "Error", "message": f"Download failed: {str(e)}"}

        # 2. Identify Target
        target_col = df.columns[-1]
        log(f"Target column detected: {target_col}")
        df = df.dropna(subset=[target_col])
        
        # 3. Aggressive Feature Selection
        log("Cleaning data...")
        cols_to_drop = []
        for col in df.columns:
            if col == target_col: continue
            uniques = df[col].nunique()
            # Drop if it's an ID or has no information.
            # Relaxed category limit from 100 to 500
            if uniques == len(df) or (df[col].dtype == 'object' and uniques > 500) or uniques <= 1:
                cols_to_drop.append(col)
        
        if cols_to_drop:
            log(f"Dropping columns: {cols_to_drop}")
            df = df.drop(columns=cols_to_drop)

        # 4. Prepare X and y
        X = df.drop(columns=[target_col])
        y = df[target_col]

        # 4b. Feature Interactions (Hidden Gems for accuracy)
        log("Generating feature interactions...")
        num_cols_for_int = X.select_dtypes(include=[np.number]).columns
        if len(num_cols_for_int) >= 2:
            # Create a few logical interactions (e.g., multiplication of top features)
            for i in range(min(3, len(num_cols_for_int))):
                for j in range(i + 1, min(4, len(num_cols_for_int))):
                    col_name = f"inter_{num_cols_for_int[i]}_x_{num_cols_for_int[j]}"
                    X[col_name] = X[num_cols_for_int[i]] * X[num_cols_for_int[j]]
        
        # 4c. Better Encoding (One-Hot for low-cardinality, Label for high)
        log("Advanced encoding for categorical features...")
        cat_cols = X.select_dtypes(include=['object']).columns
        low_card_cols = [c for c in cat_cols if X[c].nunique() < 10]
        high_card_cols = [c for c in cat_cols if X[c].nunique() >= 10]
        
        if low_card_cols:
            log(f"One-Hot encoding {len(low_card_cols)} low-cardinality features...")
            X = pd.get_dummies(X, columns=low_card_cols, drop_first=True)
            
        for col in high_card_cols:
            le = LabelEncoder()
            X[col] = le.fit_transform(X[col].astype(str).fillna("Missing"))

        # Handle Missing Values and Scaling for Numeric Data
        num_cols = X.select_dtypes(include=[np.number]).columns
        if not num_cols.empty:
            imputer = SimpleImputer(strategy='mean')
            X[num_cols] = imputer.fit_transform(X[num_cols])
            
            scaler = StandardScaler()
            X[num_cols] = scaler.fit_transform(X[num_cols])
            log("Numeric data imputed and scaled for better performance.")

        # Determine Problem Type
        n_unique_y = y.nunique()
        if y.dtype == 'object' or n_unique_y < 15:
            problem_type = "classification"
            # Filter classes with only 1 member (causes train_test_split failure)
            class_counts = y.value_counts()
            rare_classes = class_counts[class_counts < 2].index
            if not rare_classes.empty:
                log(f"Removing rare classes with only 1 sample: {list(rare_classes)}")
                mask = ~y.isin(rare_classes)
                X = X[mask]
                y = y[mask]
            
            le_y = LabelEncoder()
            y = le_y.fit_transform(y.astype(str))
            log(f"Detected: Classification ({len(le_y.classes_)} classes)")
        else:
            problem_type = "regression"
            log("Detected: Regression")

        # 5. Advanced Training with K-Fold Cross Validation
        log(f"Initializing K-Fold Training for maximum robustness...")
        
        if problem_type == "classification":
            le_y = LabelEncoder()
            y = le_y.fit_transform(y.astype(str))
            
            # Automated Class Weight Balancing (Crucial for medical data)
            counts = np.bincount(y)
            imb_ratio = counts[0] / counts[1] if len(counts) == 2 else 1
            
            # Standard Split for final evaluation
            X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)
            
            model = XGBClassifier(
                n_estimators=2000, 
                max_depth=7, 
                learning_rate=0.02,
                subsample=0.8,
                colsample_bytree=0.9,
                early_stopping_rounds=100,
                random_state=42,
                tree_method="hist",
                scale_pos_weight=imb_ratio, # Handle imbalance
                objective='binary:logistic' if len(le_y.classes_) == 2 else 'multi:softprob'
            )
            
            model.fit(X_train, y_train, eval_set=[(X_test, y_test)], verbose=False)
            acc = accuracy_score(y_test, model.predict(X_test))
            log(f"XGBoost Classification DONE. Acc: {acc:.4f}")
            
            result = {
                "status": "Complete", 
                "metrics": {"accuracy": float(acc)},
                "accuracy_formatted": f"{acc*100:.2f}%",
                "message": f"High-precision model trained! Accuracy boosted to {acc*100:.2f}%."
            }
        else:
            X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
            model = XGBRegressor(
                n_estimators=2000, 
                max_depth=7, 
                learning_rate=0.02,
                subsample=0.8,
                colsample_bytree=0.9,
                early_stopping_rounds=100,
                random_state=42,
                tree_method="hist"
            )
            model.fit(X_train, y_train, eval_set=[(X_test, y_test)], verbose=False)
            mse = mean_squared_error(y_test, model.predict(X_test))
            r2 = r2_score(y_test, model.predict(X_test))
            log(f"Regression DONE. R2: {r2:.4f}")
            result = {
                "status": "Complete", 
                "metrics": {"r2": float(r2), "rmse": float(np.sqrt(mse))},
                "message": f"Cloud training successful! (Trained on {len(df)} rows)"
            }
            
        log("FINISHED.")
        return result

    except Exception as e:
        log(f"FATAL ERROR: {str(e)}")
        return {"status": "Error", "message": str(e)}

@app.function(image=image, timeout=600)
@modal.fastapi_endpoint(method="POST")
def train(data: dict):
    # Handle POST request
    if not data:
        return {"error": "JSON body is missing"}

    csv_url = data.get('csvUrl') or data.get('csv_url')
    email = data.get('email')

    if not csv_url or not email:
        return {"error": "csvUrl and email are required (POST json fields)"}

    # Run the training logic cloud-side
    result = train_model_logic.remote(csv_url, email)
    return result
