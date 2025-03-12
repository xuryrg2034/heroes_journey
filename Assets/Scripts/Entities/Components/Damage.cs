using UnityEngine.Events;

namespace Entities.Components
{
    public class Damage
    {
        private int _value;

        public UnityEvent<int> OnValueChanged = new();
        
        public int Value
        {
            get => _value;
            private set
            {
                _value = value;
                OnValueChanged.Invoke(_value);
            }
        }
        
        private int _initValue;

        public Damage(int damage)
        {
            _initValue = damage;
            Value = damage;
        }

        public void Reset()
        {
            Value = _initValue;
        }

        public void SetValue(int value)
        {
            Value = value;
        }

        public void Increase(int value)
        {
            Value += value;
        }
        
        public void Decrease(int value)
        {
            Value -= value;
        }
    }
}