
export function timestampToString(ts: Date): string {

    try {

        if (!ts) {
            return '';
        }

        const milliseconds = (new Date().getTime() - ts.getTime());
        if (milliseconds <= 0) {
            return '';
        }

        const days = Math.floor(milliseconds / 86400000);

        if (days <= 0) {
            return 'created today';
        }

        const years = Math.floor(days / 365);

        if (years > 1) {
            
            return `created ${years} years ago`;

        } else if (years === 1) {
            
            return `created 1 year ago`;
        }

        const months = Math.floor(days / 30);

        if (months > 1) {
            
            return `created ${months} months ago`;

        } else if (months === 1) {
            
            return `created 1 month ago`;
        }

        if (days === 1) {
            
            return `created 1 day ago`;

        } else {

            return `created ${days} days ago`;
        }

    } catch {
        return '';
    }
}
