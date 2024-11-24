import React from "react";

// Incorrectly written functional component
interface ButtonProps {
  label: string;
  onClick?: () => void;
}

// Mistake: Missing return statement
const Button: React.FC<ButtonProps> = ({ label, onClick }) => {
  <button onClick={onClick}>{label}</button>;
};

// Incorrect use of prop types and missing key attribute in map
export const App = () => {
  const items = ["Item 1", "Item 2", "Item 3"];

  return (
    <div>
      <h1>React with TypeScript</h1>

      {/* Mistake: No key property on array rendering */}
      {items.map((item) => (
        <li>{item}</li>
      ))}

      {/* Mistake: Missing prop 'onClick' */}
      <Button label="Click Me" />
    </div>
  );
};

export default App;
