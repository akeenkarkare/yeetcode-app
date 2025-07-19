import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const RANKS = [
  { name: 'Script Kiddie', min: 0, max: 499 },
  { name: 'Debugger', min: 500, max: 1499 },
  { name: 'Stack Overflower', min: 1500, max: 3499 },
  { name: 'Algorithm Apprentice', min: 3500, max: 6499 },
  { name: 'Loop Guru', min: 6500, max: 11999 },
  { name: 'Recursion Wizard', min: 12000, max: 19999 },
  { name: 'Regex Sorcerer', min: 20000, max: 34999 },
  { name: 'Master Yeeter', min: 35000, max: 49999 },
  { name: '0xDEADBEEF', min: 50000, max: Infinity },
];

function getRankAndSubdivision(xp) {
  for (let i = 0; i < RANKS.length; i++) {
    const { name, min, max } = RANKS[i];
    if (xp >= min && xp <= max) {
      const range = max - min + 1;
      const subSize = Math.floor(range / 3);
      let sub = 'I';
      if (xp >= min + 2 * subSize) sub = 'III';
      else if (xp >= min + subSize) sub = 'II';
      return { name, sub };
    }
  }
  return { name: 'Unranked', sub: '' };
}

const FriendsLeaderboard = ({ leaderboard, userData, notifications = [] }) => {
  // Tab state
  const [activeTab, setActiveTab] = useState('friends');
  // Tooltip state
  const [hoveredUser, setHoveredUser] = useState(null);

  // XP calculation function
  const calculateXP = user => {
    const baseXP = user.easy * 100 + user.medium * 300 + user.hard * 500;
    const bonusXP = user.xp || 0;
    return baseXP + bonusXP;
  };

  const getRankLabel = xp => {
    const { name: rankName, sub: rankSub } = getRankAndSubdivision(xp);
    return `${rankName} ${rankSub}`;
  };

  const userUniversity =
    userData.university === 'other'
      ? userData.customUniversity
      : userData.university;
  const uniLeaderboard = useMemo(
    () =>
      leaderboard.filter(
        u => (u.university || '').toLowerCase() === (userUniversity || '').toLowerCase()
      ),
    [leaderboard, userUniversity]
  );

  const renderTable = data => (
    <div className="h-full overflow-y-auto custom-scrollbar">
      <table className="min-w-full table-fixed">
        <thead className="bg-yellow-100 sticky top-0 z-10">
          <tr className="border-b-2 border-black">
            <th className="font-bold text-left px-4 py-2 w-16">RANK</th>
            <th className="font-bold text-left px-4 py-2 w-32">PLAYER</th>
            <th className="font-bold text-center px-4 py-2 w-16">EASY</th>
            <th className="font-bold text-center px-4 py-2 w-16">MED</th>
            <th className="font-bold text-center px-4 py-2 w-16">HARD</th>
            <th className="font-bold text-center px-4 py-2 w-20">TOTAL</th>
            <th className="font-bold text-center px-4 py-2 w-24">XP</th>
          </tr>
        </thead>
        <tbody>
          <AnimatePresence mode="popLayout">
            {data
              .sort((a, b) => calculateXP(b) - calculateXP(a))
              .map((user, index) => {
                const isCurrentUser =
                  user.username === userData.leetUsername?.toLowerCase();
                const total = user.easy + user.medium + user.hard;
                const userXP = calculateXP(user);
                const bgColor =
                  index === 0
                    ? 'bg-red-100'
                    : index === 1
                      ? 'bg-blue-100'
                      : index === 2
                        ? 'bg-green-100'
                        : isCurrentUser
                          ? 'bg-blue-50 border-l-4 border-blue-400'
                          : '';

                const textStyle = isCurrentUser
                  ? 'font-semibold text-blue-700'
                  : '';
                const rankStyle = isCurrentUser
                  ? 'font-bold text-blue-700'
                  : 'font-bold';

                return (
                  <motion.tr
                    key={user.username}
                    layout
                    initial={{ opacity: 0, x: -20, scale: 0.95 }}
                    animate={{
                      opacity: 1,
                      x: 0,
                      scale: 1,
                      backgroundColor:
                        index === 0
                          ? '#fee2e2'
                          : index === 1
                            ? '#dbeafe'
                            : index === 2
                              ? '#dcfce7'
                              : isCurrentUser
                                ? '#eff6ff'
                                : '#ffffff',
                    }}
                    exit={{ opacity: 0, x: 20, scale: 0.95 }}
                    transition={{
                      layout: { duration: 0.4, ease: 'easeInOut' },
                      default: { duration: 0.3 },
                    }}
                    className={`border-b border-gray-200 ${bgColor}`}
                  >
                    <motion.td className={`px-4 py-3 w-16 ${rankStyle}`} layout>
                      <motion.span
                        key={`rank-${index}`}
                        initial={{ scale: 1.2, color: '#f59e0b' }}
                        animate={{ scale: 1, color: '#000' }}
                        transition={{ duration: 0.3 }}
                      >
                        #{index + 1}
                      </motion.span>
                    </motion.td>
                    <motion.td className="px-4 py-3 w-32" layout>
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border border-black ${isCurrentUser ? 'bg-blue-200 text-blue-800' : 'bg-gray-300'}`}
                        >
                          {user.name.substring(0, 2).toUpperCase()}
                        </div>
                        <span
                          className={
                            isCurrentUser ? 'font-semibold text-blue-700' : ''
                          }
                          onMouseEnter={() => setHoveredUser(user.username)}
                          onMouseLeave={() => setHoveredUser(null)}
                          style={{ position: 'relative', cursor: 'pointer' }}
                        >
                          {isCurrentUser ? 'You' : user.name}
                          {hoveredUser === user.username && (
                            <div className="absolute left-1/2 bottom-full z-50 mb-1 -translate-x-1/2 bg-black text-white text-xs rounded px-3 py-1 shadow-lg border-2 border-yellow-300 whitespace-nowrap pointer-events-none animate-fade-in-down">
                              {getRankLabel(userXP)}
                            </div>
                          )}
                        </span>
                      </div>
                    </motion.td>
                    <motion.td
                      className={`text-center px-4 py-3 w-16 ${textStyle}`}
                      layout
                    >
                      <motion.span
                        key={`easy-${user.easy}`}
                        initial={{ scale: 1.2, color: '#10b981' }}
                        animate={{ scale: 1, color: '#000' }}
                        transition={{ duration: 0.3 }}
                      >
                        {user.easy}
                      </motion.span>
                    </motion.td>
                    <motion.td
                      className={`text-center px-4 py-3 w-16 ${textStyle}`}
                      layout
                    >
                      <motion.span
                        key={`medium-${user.medium}`}
                        initial={{ scale: 1.2, color: '#f59e0b' }}
                        animate={{ scale: 1, color: '#000' }}
                        transition={{ duration: 0.3 }}
                      >
                        {user.medium}
                      </motion.span>
                    </motion.td>
                    <motion.td
                      className={`text-center px-4 py-3 w-16 ${textStyle}`}
                      layout
                    >
                      <motion.span
                        key={`hard-${user.hard}`}
                        initial={{ scale: 1.2, color: '#ef4444' }}
                        animate={{ scale: 1, color: '#000' }}
                        transition={{ duration: 0.3 }}
                      >
                        {user.hard}
                      </motion.span>
                    </motion.td>
                    <motion.td
                      className={`text-center px-4 py-3 w-20 font-bold ${isCurrentUser ? 'text-blue-700' : 'text-blue-600'}`}
                      layout
                    >
                      <motion.span
                        key={`total-${total}`}
                        initial={{ scale: 1.3, color: '#2563eb' }}
                        animate={{ scale: 1, color: '#000' }}
                        transition={{ duration: 0.4 }}
                      >
                        {total}
                      </motion.span>
                    </motion.td>
                    <motion.td
                      className={`text-center px-4 py-3 w-24 font-bold ${isCurrentUser ? 'text-purple-700' : 'text-purple-600'}`}
                      layout
                    >
                      <motion.span
                        key={`xp-${userXP}`}
                        initial={{ scale: 1.3, color: '#7c3aed' }}
                        animate={{ scale: 1, color: '#000' }}
                        transition={{ duration: 0.4 }}
                      >
                        {userXP.toLocaleString()}
                      </motion.span>
                    </motion.td>
                  </motion.tr>
                );
              })}
          </AnimatePresence>
        </tbody>
      </table>
    </div>
  );

  // Check if any notification is a 'left' type for this cycle
  const hasLeftNotification = notifications.some(n => n.type === 'left');
  // Filter out overtake notifications if someone left
  const filteredNotifications = hasLeftNotification
    ? notifications.filter(n => n.type !== 'overtake')
    : notifications;

  return (
    <div
      className="bg-yellow-100 border-4 border-black rounded-xl overflow-hidden shadow-lg flex flex-col"
      style={{ height: '310px' }}
    >
      <div className="bg-blue-500 px-6 py-4 border-b-4 border-black flex-shrink-0">
        {/* Header: Title + Tabs + Notifications */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-4">
            <span className="text-white text-lg">🏆</span>
            <h3 className="font-bold text-white text-lg">LEADERBOARD</h3>
            {/* Tabs (inline with title) */}
            <div className="flex gap-2 ml-4">
              <button
                className={`btn-3d shadow-md px-3 py-1 rounded-lg font-bold border-2 border-b-0 border-white focus:outline-none transition-colors text-sm ${
                  activeTab === 'friends'
                    ? 'bg-yellow-100 text-black'
                    : 'bg-blue-200 text-black hover:bg-yellow-200'
                }`}
                onClick={() => setActiveTab('friends')}
              >
                Friends
              </button>
              <button
                className={`btn-3d shadow-md px-3 py-1 rounded-lg font-bold border-2 border-b-0 border-white focus:outline-none transition-colors text-sm ${
                  activeTab === 'university'
                    ? 'bg-yellow-100 text-black'
                    : 'bg-blue-200 text-black0 hover:bg-yellow-200'
                }`}
                onClick={() => setActiveTab('university')}
              >
                University
              </button>
            </div>
          </div>
          {/* Notification Bar (inline) */}
          <div className="relative min-h-[24px] flex items-center">
            <AnimatePresence mode="popLayout">
              {filteredNotifications.map(notification => (
                <motion.div
                  key={notification.id}
                  initial={{ opacity: 0, y: -20, scale: 0.8 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -20, scale: 0.8 }}
                  transition={{ duration: 0.3 }}
                  className={`flex items-center gap-2 px-3 py-1 rounded-lg border-2 border-white text-white font-bold ml-2 shadow-lg text-sm ${
                    notification.type === 'overtake'
                      ? 'bg-orange-400'
                      : notification.type === 'joined'
                        ? 'bg-green-500'
                        : notification.type === 'left'
                          ? 'bg-red-500'
                          : 'bg-blue-500'
                  }`}
                >
                  <span>
                    {notification.type === 'overtake' && '🏃‍♂️'}
                    {notification.type === 'joined' && '🎉'}
                    {notification.type === 'left' && '👋'}
                  </span>
                  <span>{notification.message}</span>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-hidden">
        {activeTab === 'university' ? (
          uniLeaderboard.length ? (
            renderTable(uniLeaderboard)
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-gray-500 text-lg font-bold">
              <span>🏫 University Leaderboard</span>
              <span className="mt-2">No players yet!</span>
            </div>
          )
        ) : leaderboard.length === 0 ? (
          <div className="text-center text-gray-500 py-8">
            No competitors yet! Invite friends to join.
          </div>
        ) : (
          renderTable(leaderboard)
        )}
      </div>
    </div>
  );
};

export default FriendsLeaderboard;
