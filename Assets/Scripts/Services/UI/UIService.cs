using System;
using Core.Entities;
using Services.Grid;
using TMPro;
using UnityEngine;
using UnityEngine.Serialization;
using UnityEngine.UI;

namespace Services.UI
{
    public class UIService : MonoBehaviour
    {
        [Header("UI Elements")]
        [SerializeField] private Button executeButton;
        [SerializeField] private Button endTurnButton;
        [SerializeField] private TextMeshProUGUI heroPower;

        private void Start()
        {
            
            GameService.OnGameStateChange.AddListener(_toggleButtonInteractable);
            // _hero.OnAttackDamageChanged += _showPower;
            
            // _showPower(_hero.RemainingDamage);
        }

        // private void _showPower(int value)
        // {
        //     heroPower.text = $"Power: {value}";
        // }
        
        private void _toggleButtonInteractable(GameState state)
        {
            executeButton.interactable = state == GameState.WaitingForInput;
            endTurnButton.interactable = state == GameState.WaitingForInput;
        }
    }
}