export interface stats {
    totalSeconds: number,
    createdAt: Date
}

export const emptyStats = { 
    totalSeconds: 0,
    createdAt: new Date()
}

export function GetTotalTime(seconds: number) {
    const hours = Math.floor( seconds / 3600 );
    const minutes = Math.floor( ( seconds % 3600 ) / 60 );
    const remSeconds = Math.round( ( seconds % 3600 ) % 60 );
    return `${hours || 0} hours, ${minutes || 0} minutes and ${remSeconds || 0} seconds`;
}

export const commands = [
    {
        name: "/voice [voice channel (if required)]",
        description: "Shows time spent on a specific channel or server."
    },
    {
        name: "/game [name of game]",
        description: "Shows time spent on a specific game or activity."
    },
];