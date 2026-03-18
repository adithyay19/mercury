export function GetTotalTime(seconds: number) {
    const hours = Math.floor( seconds / 3600 );
    const minutes = Math.floor( ( seconds % 3600 ) / 60 );
    const remSeconds = Math.round( ( seconds % 3600 ) % 60 );
    return `${hours || 0} hours, ${minutes || 0} minutes and ${remSeconds || 0} seconds`;
}