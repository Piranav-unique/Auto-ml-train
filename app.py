import os
import pandas as pd
import numpy as np
from flask import Flask, request, jsonify
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder
from sklearn.metrics import accuracy_score, mean_squared_error, r2_score
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
import requests
import threading

app = Flask(__name__)

@app.route('/', methods=['GET'])
def home():
    return jsonify({
        "message": "Welcome to the Auto ML Training API",
        "endpoints": {
            "root": "/",
            "train": "/train (POST)",
            "status": "/status (GET)"
        }
    }), 200

def train_model_logic(csv_url, email, callback_url=None):
    try:
        print(f"Starting general training for {email} with data from {csv_url}")
        
        # 1. Load Dataset (Limit to 7,500 rows for high accuracy + sub-20s speed)
        df = pd.read_csv(csv_url, nrows=7500)
        
        # 2. Identify Target Column (Assume last column is target)
        target_col = df.columns[-1]
        
        # Pre-cleaning: Drop rows where target is NaN
        df = df.dropna(subset=[target_col])
        
        # 3. Feature Selection & Cleaning
        # Drop columns that look like IDs or have 100% unique values (and are strings)
        cols_to_drop = []
        for col in df.columns:
            if col == target_col: continue
            
            # Drop if all values are unique and it's a string/object (likely an ID)
            if df[col].nunique() == len(df) and df[col].dtype == 'object':
                cols_to_drop.append(col)
            # Drop if it has only one unique value (no information)
            elif df[col].nunique() <= 1:
                cols_to_drop.append(col)
                
        if cols_to_drop:
            print(f"Dropping uninformative columns: {cols_to_drop}")
            df = df.drop(columns=cols_to_drop)

        # 4. Split Features and Target
        X = df.drop(columns=[target_col])
        y = df[target_col]

        # 5. Handle Categorical Features & Missing Values
        # Identify numeric vs categorical
        numeric_cols = X.select_dtypes(include=[np.number]).columns.tolist()
        categorical_cols = X.select_dtypes(exclude=[np.number]).columns.tolist()

        # Impute numeric with median (more robust than mean)
        for col in numeric_cols:
            X[col] = X[col].fillna(X[col].median())

        # Impute categorical with 'Missing' and Label Encode
        for col in categorical_cols:
            X[col] = X[col].fillna("Missing").astype(str)
            le = LabelEncoder()
            X[col] = le.fit_transform(X[col])

        # 6. Determine Problem Type & Encode Target
        # Force conversion to numeric if possible
        if y.dtype == 'object':
            # Try converting and see if we get too many NaNs
            y_numeric = pd.to_numeric(y, errors='coerce')
            if y_numeric.isna().sum() < (len(y) * 0.05): # Less than 5% conversion failure
                y = y_numeric.fillna(y_numeric.median())
                print("Target converted to numeric for regression analysis.")

        n_unique = y.nunique()
        print(f"Target column: '{target_col}', Unique values: {n_unique}, Dtype: {y.dtype}")

        # Heuristic for Problem Type:
        # 1. If it's still object/string -> Classification
        # 2. If it's numeric AND has very few unique values -> Classification
        # 3. Otherwise -> Regression
        if y.dtype == 'object' or n_unique < 15:
            problem_type = "classification"
            le_y = LabelEncoder()
            y = le_y.fit_transform(y.astype(str))
            print(f"Set to Classification (Classes: {len(le_y.classes_)})")
        else:
            problem_type = "regression"
            print("Set to Regression")

        print(f"Final Problem Type: {problem_type}")
        
        # 7. Train Test Split
        X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
        
        # 8. Model Training
        if problem_type == "classification":
            # Balanced settings: 50 trees is robust but fast on 7.5k rows
            model = RandomForestClassifier(n_estimators=50, max_depth=12, min_samples_split=5, random_state=42)
            model.fit(X_train, y_train)

            y_pred = model.predict(X_test)
            accuracy = accuracy_score(y_test, y_pred)
            
            result = {
                "status": "Complete", 
                "type": "Classification", 
                "metrics": {"accuracy": float(accuracy)},
                "email": email,
                "message": f"Training successful! Accuracy: {accuracy*100:.2f}% (Model: Random Forest)"
            }
        else:
            model = RandomForestRegressor(n_estimators=50, max_depth=12, min_samples_split=5, random_state=42)
            model.fit(X_train, y_train)
            y_pred = model.predict(X_test)
            
            mse = mean_squared_error(y_test, y_pred)
            rmse = np.sqrt(mse)
            r2 = r2_score(y_test, y_pred)
            
            result = {
                "status": "Complete", 
                "message": f"Training successful! (Model: Random Forest)",
                "details": f"RMSE: {rmse:.2f}, R2 Score: {r2:.4f}"
            }
            
        print(f"Training result: {result['message']}")

        # 9. Send Callback if provided
        if callback_url:
            print(f"Sending callback to {callback_url}")
            try:
                requests.post(callback_url, json=result, timeout=10)
            except Exception as e:
                print(f"Callback failed: {e}")

        return result

    except Exception as e:
        error_msg = str(e)
        print(f"Error during training: {error_msg}")
        err_result = {
            "status": "Error", 
            "message": f"Training failed: {error_msg}", 
            "email": email
        }
        if callback_url:
            try: requests.post(callback_url, json=err_result, timeout=10)
            except: pass
        return err_result

@app.route('/train', methods=['POST'])
def train():
    data = request.get_json(force=True)
    csv_url = data.get('csvUrl') or data.get('csv_url') or data.get('csvurl')
    email = data.get('email')

    callback_url = data.get('callbackUrl')
    
    if not csv_url or not email:
        return jsonify({"error": "csvUrl and email are required"}), 400
        
    # Clean inputs
    csv_url = str(csv_url).strip().lstrip('-').strip()
    email = str(email).strip().lstrip('-').strip()
    
    # Synchronous training as requested by the user
    # Note: Risk of 502 Bad Gateway if training > 30s on Render
    result = train_model_logic(csv_url, email, callback_url)
    
    return jsonify(result), 200



@app.route('/status', methods=['GET'])
def status():
    return jsonify({"status": "ML API is running"}), 200

if __name__ == '__main__':
    port = int(os.environ.get("PORT", 5000))
    app.run(host='0.0.0.0', port=port)
