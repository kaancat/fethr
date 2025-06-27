import React from 'react';
import { useNavigate } from 'react-router-dom';
import { XCircle } from 'lucide-react';

export default function PaymentCancelPage() {
    const navigate = useNavigate();

    return (
        <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
            <div className="max-w-md w-full bg-gray-800 rounded-lg shadow-xl p-8 text-center">
                <XCircle className="w-20 h-20 text-red-500 mx-auto mb-4" />
                <h1 className="text-3xl font-bold text-white mb-2">Payment Cancelled</h1>
                <p className="text-gray-300 mb-6">
                    Your subscription upgrade was cancelled. You can try again anytime.
                </p>
                <button
                    onClick={() => navigate('/')}
                    className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-6 rounded-lg transition-colors"
                >
                    Back to App
                </button>
            </div>
        </div>
    );
}