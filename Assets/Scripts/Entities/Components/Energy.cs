using UnityEngine.Events;

namespace Entities.Components
{
    public class Energy
    {
        private int _max;

        private int _min;
        
        private int _value;

        private int _reserved;
        
        public UnityEvent<int> OnValueChanged = new();
        
        public UnityEvent<int> OnReservedChanged = new();

        public int Value
        {
            get => _value;
            private set
            {
                _value = value;
                OnValueChanged.Invoke(_value);
            }
        }
        
        public int Reserved
        {
            get => _reserved;
            private set
            {
                _reserved = value;
                OnReservedChanged.Invoke(_reserved);
            }
        }

        private int _initValue;

        public Energy(int energy, int max)
        {
            _initValue = energy;
            _max = max;
            Value = energy;
        }

        public void Reset()
        {
            Value = _initValue;
        }

        public void SetValue(int value)
        {
            Value = value;
        }

        public void Increase(int value = 1)
        {
            if (Value + value > _max) return;
            
            Value += value;
        }
        
        public void Decrease(int value = 1)
        {
            if (Value - value < _min) return;

            Value -= value;
        }

        public void SetReserve(int value)
        {
            Reserved = value;
        }
    }
}