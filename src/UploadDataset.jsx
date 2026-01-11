import { useState } from "react";
import axios from "axios";

function UploadDataset() {
    const [csv, setCsv] = useState(null);
    const [email, setEmail] = useState("");
    const [status, setStatus] = useState("");

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (!csv || !email) {
            alert("Please upload CSV and email");
            return;
        }

        const formData = new FormData();
        formData.append("csv", csv);
        formData.append("email", email);

        try {
            setStatus("Uploading dataset...");
            await axios.post(
                `${process.env.REACT_APP_API_URL || "http://localhost:5000"}/api/upload`,
                formData,
                { headers: { "Content-Type": "multipart/form-data" } }
            );
            setStatus("✅ Dataset uploaded successfully");
        } catch (err) {
            console.error(err);
            setStatus("❌ Upload failed");
        }
    };

    return (
        <div style={{ padding: "40px", maxWidth: "500px" }}>
            <h2>ML Dataset Upload</h2>

            <form onSubmit={handleSubmit}>
                <label>CSV File</label><br />
                <input
                    type="file"
                    accept=".csv"
                    onChange={(e) => setCsv(e.target.files[0])}
                />
                <br /><br />

                <label>Email</label><br />
                <input
                    type="email"
                    required
                    onChange={(e) => setEmail(e.target.value)}
                />
                <br /><br />

                <button type="submit">Train Model</button>
            </form>

            <p>{status}</p>
        </div>
    );
}

export default UploadDataset;
