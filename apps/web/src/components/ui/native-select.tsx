import React from 'react'
/** Plain-web boundary; the Harness build maps these to its official Menu/Checkbox. */
export function NativeSelect(props: React.SelectHTMLAttributes<HTMLSelectElement>) { return <select {...props} /> }
export function Choice({label,className,...props}: React.InputHTMLAttributes<HTMLInputElement> & {label?:string}) { return label ? <label className={className}><input type="checkbox" {...props} />{label}</label> : <input type="checkbox" className={className} {...props} /> }
