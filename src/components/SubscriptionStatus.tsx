import React from 'react';
import { Crown } from 'lucide-react';

interface SubscriptionStatusProps {
    wordUsage: number;
    wordLimit: number;
    isUnlimited: boolean;
    hasActiveSubscription: boolean;
}

export const SubscriptionStatus: React.FC<SubscriptionStatusProps> = ({
    wordUsage,
    wordLimit,
    isUnlimited,
    hasActiveSubscription
}) => {
    if (!hasActiveSubscription) {
        return null;
    }

    const usagePercentage = isUnlimited ? 0 : (wordUsage / wordLimit) * 100;
    const isNearLimit = usagePercentage >= 80 && !isUnlimited;
    
    const formatNumber = (num: number) => {
        if (num >= 1000000) {
            return `${(num / 1000000).toFixed(1)}M`;
        } else if (num >= 1000) {
            return `${(num / 1000).toFixed(0)}k`;
        }
        return num.toString();
    };

    return (
        <div className="absolute -bottom-6 left-1/2 transform -translate-x-1/2 whitespace-nowrap">
            <div className="flex items-center space-x-1 text-[10px]">
                {isUnlimited ? (
                    <>
                        <Crown className="w-3 h-3 text-yellow-500" />
                        <span className="text-gray-400">Pro • Unlimited</span>
                    </>
                ) : (
                    <>
                        <span className={`font-medium ${isNearLimit ? 'text-yellow-400' : 'text-gray-400'}`}>
                            {formatNumber(wordUsage)} / {formatNumber(wordLimit)}
                        </span>
                        <span className="text-gray-500">words</span>
                    </>
                )}
            </div>
            {!isUnlimited && (
                <div className="mt-0.5 w-full bg-gray-700 rounded-full h-1 overflow-hidden">
                    <div
                        className={`h-full transition-all duration-300 ${
                            isNearLimit ? 'bg-yellow-400' : 'bg-blue-400'
                        }`}
                        style={{ width: `${Math.min(usagePercentage, 100)}%` }}
                    />
                </div>
            )}
        </div>
    );
};