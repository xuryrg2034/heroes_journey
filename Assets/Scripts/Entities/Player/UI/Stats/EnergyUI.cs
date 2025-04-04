using System;
using Entities.Components;
using TMPro;
using UnityEditor;
using UnityEngine;
namespace Entities.Player
{
    public class EnergyUI : MonoBehaviour
    {
        [SerializeField] GameObject energyPrefab;
        [SerializeField] GameObject containerObject;

        Energy _energy;
        
        GameObject[] _energyList;

        int MaxValue => _energy.MaxEnergy;
        
        int CurrentValue => _energy.Value;
        
        int Reserved => _energy.Reserved;
        
        public void Initialize(Energy energy)
        {
           _energy = energy;
           _energyList = new GameObject[MaxValue];
           

           InitEnergiesObject();

           _energy.OnReservedChanged.AddListener(UpdateReserved);
           _energy.OnValueChanged.AddListener(UpdateCurrentEnergy);
        }

        void InitEnergiesObject()
        {
            for (var i = 0; i < MaxValue; i++)
            {
                _energyList[i] = Instantiate(energyPrefab, containerObject.transform);
            }
        }
        
        void UpdateReserved(int value)
        {
            Debug.Log($"Reserved {value}");
            if (value <= 0) return;
            
            var activeEnergy = CurrentValue;
            var threshold = Mathf.Max(0, activeEnergy - value);

            for (var i = 0; i < activeEnergy; i++)
            {
                var sr = _energyList[i].GetComponent<SpriteRenderer>();
                var color = sr.color;

                // Резервирование энергии
                if (i >= threshold)
                {
                    color.a = 0.5f;
                }
                // Освобождение от резервирования энергии
                else
                {
                    color.a = 1;
                }
                
                sr.color = color;
            }
        }

        void UpdateCurrentEnergy(int value)
        {
            Debug.Log($"CurrentEnergy {value}");
            var arrayLength = _energyList.Length;
            var threshold = value - 1;

            for (var i = 0; i < arrayLength; i++)
            {
                var sr = _energyList[i].GetComponent<SpriteRenderer>();
                var color = sr.color;

                if (i > threshold)
                {
                    color.a = 0.5f;
                }
                else
                {
                    color.a = 1;
                }
                
                sr.color = color;
            }
        }
    }
}
