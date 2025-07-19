import React, { useState, useEffect } from 'react';
import { useAnalytics } from '../utils/analytics';

const OnboardingStep = ({
  animationClass,
  error,
  userData,
  setUserData,
  validating,
  showSuccess,
  handleValidateLeet,
}) => {
  const analytics = useAnalytics();

  // Track user registration when validation is successful
  useEffect(() => {
    if (showSuccess && userData.name && userData.leetUsername) {
      analytics.trackUserRegistration(userData.name, userData.leetUsername);
    }
  }, [showSuccess, userData.name, userData.leetUsername, analytics]);

  return (
    <div className={`flex flex-col gap-4 ${animationClass}`}>
      <div className="text-center mb-2">
        <h2 className="text-lg font-bold">
          Almost there! Let's connect your LeetCode
        </h2>
        {userData.email && (
          <div className="mt-2 p-2 bg-green-50 border border-green-300 rounded-lg">
            <p className="text-green-700 text-sm">
              ✅ Email verified:{' '}
              <span className="font-bold">{userData.email}</span>
            </p>
          </div>
        )}
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-bold mb-1">Your Name</label>
          <input
            className="border-2 border-black rounded-lg px-3 py-2 w-full focus:border-blue-500 focus:outline-none transition-colors"
            placeholder="Enter your first name"
            value={userData.name}
            onChange={e => setUserData({ ...userData, name: e.target.value })}
          />
        </div>

        <div>
          <label className="block text-sm font-bold mb-1">
            LeetCode Username
          </label>
          <div className="flex gap-2">
            <input
              className="border-2 border-black rounded-lg px-3 py-2 flex-1 focus:border-blue-500 focus:outline-none transition-colors"
              placeholder="Your LeetCode username"
              value={userData.leetUsername}
              onChange={e =>
                setUserData({ ...userData, leetUsername: e.target.value })
              }
            />
            <button
              onClick={handleValidateLeet}
              disabled={validating}
              className={`px-4 py-2 ${validating ? 'bg-gray-400 text-gray-200' : 'bg-yellow-300 hover:bg-yellow-500 text-black'} border-2 border-black rounded-lg font-bold ${!validating ? 'btn-3d' : 'cursor-not-allowed'}`}
            >
              {validating ? 'Checking...' : 'Continue'}
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            We'll verify this username exists on LeetCode
          </p>
        </div>

        <div>
          <label className="block text-sm font-bold mb-1">
            University (optional)
          </label>
          <select
            className="border-2 border-black rounded-lg px-3 py-2 w-full focus:border-blue-500 focus:outline-none transition-colors"
            value={userData.university || ''}
            onChange={e => {
              const value = e.target.value;
              if (value === 'other') {
                setUserData({
                  ...userData,
                  university: 'other',
                  customUniversity: '',
                });
              } else {
                setUserData({
                  ...userData,
                  university: value,
                  customUniversity: '',
                });
              }
            }}
          >
            <option value="">No University</option>
            <option value="Massachusetts Institute of Technology">
              Massachusetts Institute of Technology
            </option>
            <option value="Stanford University">Stanford University</option>
            <option value="Carnegie Mellon University">
              Carnegie Mellon University
            </option>
            <option value="University of California, Berkeley">
              University of California, Berkeley
            </option>
            <option value="Stony Brook University">
              Stony Brook University
            </option>
            <option value="other">My university not listed</option>
          </select>
          {userData.university === 'other' && (
            <input
              className="border-2 border-black rounded-lg px-3 py-2 w-full mt-2 focus:border-blue-500 focus:outline-none transition-colors"
              placeholder="Enter your university"
              value={userData.customUniversity || ''}
              onChange={e =>
                setUserData({
                  ...userData,
                  customUniversity: e.target.value,
                })
              }
            />
          )}
        </div>
      </div>

      {error && (
        <div className="text-red-600 font-bold p-3 bg-red-50 border-2 border-red-200 rounded-lg">
          {error}
        </div>
      )}

      {showSuccess && (
        <div className="relative overflow-hidden">
          <div className="bg-orange-500 p-6 border-4 border-black rounded-xl text-center animate-pulse shadow-2xl">
            <div className="space-y-3">
              <div className="text-4xl animate-bounce">🎉</div>
              <div className="text-white font-bold text-xl">
                CODER VERIFIED!
              </div>
              <div className="text-black text-sm">
                Welcome to the competition arena
              </div>
              <div className="flex justify-center items-center gap-2 text-black">
                <span>⚡</span>
                <span className="font-bold">Initializing dashboard...</span>
                <span>⚡</span>
              </div>
            </div>
            {/* Animated background effects */}
            <div className="absolute inset-0 opacity-20">
              <div className="absolute top-2 left-4 text-yellow-200 animate-ping">
                ✨
              </div>
              <div className="absolute top-6 right-6 text-yellow-200 animate-ping delay-200">
                ✨
              </div>
              <div className="absolute bottom-4 left-8 text-yellow-200 animate-ping delay-500">
                ✨
              </div>
              <div className="absolute bottom-2 right-4 text-yellow-200 animate-ping delay-700">
                ✨
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default OnboardingStep;
