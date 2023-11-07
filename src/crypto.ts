import hmacSHA256 from 'crypto-js/hmac-sha256'
import Base64 from 'crypto-js/enc-base64';

export const base64HmacSHA256Digest = (message: string, key: string) => {
    return Base64.stringify(hmacSHA256(message, key))
}