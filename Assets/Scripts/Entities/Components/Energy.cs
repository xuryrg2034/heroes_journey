using UnityEngine.Events;

namespace Entities.Components
{
    public class Energy
    {
        public int MaxEnergy { get; }

        int _min;
        
        int _value;

        int _reserved;
        
        public UnityEvent<int> OnValueChanged = new();
        
        public UnityEvent<int> OnReservedChanged = new();

        public int Value
        {
            get => _value;
            set
            {
                _value = value;
                OnValueChanged.Invoke(_value);
            }
        }
        
        public int Reserved
        {
            get => _reserved;
            set
            {
                _reserved = value;
                OnReservedChanged.Invoke(_reserved);
            }
        }

        int _initValue;

        public Energy(int energy)
        {
            MaxEnergy = Value = energy;
        }

        public void Reset()
        {
            Value = MaxEnergy;
        }

        public void SetValue(int value)
        {
            Value = value;
        }

        public void Increase(int value = 1)
        {
            if (Value + value > MaxEnergy)
            {
                Value = MaxEnergy;
                return;
            };
            
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

        public void ResetReserve()
        {
            Reserved = 0;
        }
    }
}